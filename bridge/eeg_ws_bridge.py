#!/usr/bin/env python3
"""OpenBCI (Cyton/Daisy) → Engagement → WebSocket broadcaster.

This bridge reuses BrainFlow to stream EEG, compute the engagement metric
E = beta / (alpha + theta), normalize it using running min/max, and broadcast
the result to any number of WebSocket clients. The intent is to feed the
browser-based Assistant UI so it can adapt LLM responses in real time.

Usage::

    python bridge/eeg_ws_bridge.py \
        --serial /dev/cu.usbserial-DP05I34K \
        --ws ws://0.0.0.0:8765 \
        --apply-default-cyton-config

    separate terminal: npm run dev

Install deps::

    pip install brainflow websockets numpy

Incoming control messages (JSON) from clients:
    - {"type": "subscribe"}
    - {"type": "set_mode", "mode": "normal"|"relax"|"mental"}
    - {"type": "reset_norm"}

Outgoing engagement packets (JSON):
    {
        "type": "engagement",
        "ts": <unix_ms>,
        "fs": <sampling_rate>,
        "E": <raw>,
        "Enorm": <normalized>,
        "alpha": <bandpower>,
        "theta": <bandpower>,
        "beta": <bandpower>,
        "Emin": <float or null>,
        "Emax": <float or null>,
        "mode": "normal"|"relax"|"mental"
    }
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import signal
import time
from dataclasses import dataclass
from typing import List, Optional, Set

import numpy as np
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds

try:
    import websockets
    from websockets import WebSocketServerProtocol
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "websockets library missing. Install with `pip install websockets`."
    ) from exc


# ==== configuration ========================================================
BANDS = {
    "theta": (4.0, 7.0),
    "alpha": (7.0, 11.0),
    "beta": (11.0, 20.0),
}
EEG_PULL_PERIOD_S = 0.200  # seconds
WINDOW_S = 1.0             # bandpower window length (seconds)
GATE_STRIDE = 256          # compute metric whenever global sample idx crosses this


@dataclass
class NormState:
    Emin: float = math.inf
    Emax: float = -math.inf

    def update(self, value: float) -> None:
        if value < self.Emin:
            self.Emin = value
        if value > self.Emax:
            self.Emax = value

    def reset(self) -> None:
        self.Emin = math.inf
        self.Emax = -math.inf


def brainflow_init(serial_port: str, user_cmds: Optional[List[str]]) -> tuple[BoardShim, int]:
    params = BrainFlowInputParams()
    params.serial_port = serial_port
    board_id = BoardIds.CYTON_DAISY_BOARD.value
    board = BoardShim(board_id, params)
    board.prepare_session()
    if user_cmds:
        for cmd in user_cmds:
            board.config_board(cmd)
            time.sleep(0.05)
    board.start_stream()
    return board, board_id


def get_new_eeg(board: BoardShim, board_id: int, cache: list[Optional[List[int]]]) -> np.ndarray:
    if cache[0] is None:
        cache[0] = BoardShim.get_eeg_channels(board_id)
    data = board.get_board_data()  # pops everything available
    if data.size == 0:
        return np.empty((0, 0), dtype=np.float32)
    eeg = data[cache[0], :].T.astype(np.float32)
    return eeg


def bandpower_hann_rfft(x: np.ndarray, fs: float, f_lo: float, f_hi: float) -> float:
    n = len(x)
    if n == 0:
        return 0.0
    window = np.hanning(n)
    demeaned = (x - x.mean()) * window
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    spec = np.fft.rfft(demeaned)
    psd = (np.abs(spec) ** 2) / (np.sum(window ** 2) * fs)
    mask = (freqs >= f_lo) & (freqs < f_hi)
    if not np.any(mask):
        return 0.0
    return float(np.trapz(psd[mask], freqs[mask]))


def engagement_from_window(win: np.ndarray, fs: float) -> tuple[float, float, float, float]:
    if win.size == 0:
        return 0.0, 0.0, 0.0, 0.0
    C = win.shape[1]
    theta_p = 0.0
    alpha_p = 0.0
    beta_p = 0.0
    for c in range(C):
        sig = win[:, c]
        theta_p += bandpower_hann_rfft(sig, fs, *BANDS["theta"])
        alpha_p += bandpower_hann_rfft(sig, fs, *BANDS["alpha"])
        beta_p += bandpower_hann_rfft(sig, fs, *BANDS["beta"])
    theta_p /= C
    alpha_p /= C
    beta_p /= C
    denom = alpha_p + theta_p
    E = beta_p / denom if denom > 1e-12 else 0.0
    return float(E), float(alpha_p), float(theta_p), float(beta_p)


class EEGBridge:
    def __init__(self, serial_port: str, ws_addr: str, user_cmds: Optional[List[str]]):
        self.serial_port = serial_port
        self.ws_addr = ws_addr
        self.user_cmds = user_cmds
        self.clients: Set[WebSocketServerProtocol] = set()
        self.mode: str = "normal"
        self.norm = NormState()
        self._stop = asyncio.Event()

    async def start(self) -> None:
        host, port = self._parse_ws_addr(self.ws_addr)
        async with websockets.serve(self._handler, host, port):
            await self._stream_loop()

    async def _handler(self, ws: WebSocketServerProtocol):
        self.clients.add(ws)
        try:
            await ws.send(json.dumps({"type": "hello", "mode": self.mode}))
            async for message in ws:
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    continue
                msg_type = payload.get("type")
                if msg_type == "subscribe":
                    # no-op; stream_loop sends periodically
                    continue
                if msg_type == "set_mode":
                    mode = payload.get("mode")
                    if mode in ("normal", "relax", "mental"):
                        self.mode = mode
                        await self._broadcast({"type": "calibration", "mode": self.mode})
                if msg_type == "reset_norm":
                    self.norm.reset()
                    await self._broadcast({
                        "type": "calibration",
                        "mode": self.mode,
                        "Emin": self._finite_or_none(self.norm.Emin),
                        "Emax": self._finite_or_none(self.norm.Emax),
                    })
        finally:
            self.clients.discard(ws)

    async def _broadcast(self, obj: dict) -> None:
        if not self.clients:
            return
        payload = json.dumps(obj)
        await asyncio.gather(*(self._safe_send(client, payload) for client in list(self.clients)))

    async def _safe_send(self, ws: WebSocketServerProtocol, message: str) -> None:
        try:
            await ws.send(message)
        except Exception:
            try:
                await ws.close()
            finally:
                self.clients.discard(ws)

    async def _stream_loop(self) -> None:
        board, bid = brainflow_init(self.serial_port, self.user_cmds)
        try:
            fs = float(BoardShim.get_sampling_rate(bid))
            win_len = int(round(WINDOW_S * fs))
            cache: list[Optional[List[int]]] = [None]
            buf = np.empty((0, 0), dtype=np.float32)
            global_idx = 0
            next_gate = GATE_STRIDE
            next_pull = time.monotonic()
            last_sec = -1

            while not self._stop.is_set():
                now = time.monotonic()

                if now >= next_pull:
                    X = get_new_eeg(board, bid, cache)
                    n = X.shape[0]
                    if n > 0:
                        global_idx += n
                        if buf.size == 0:
                            buf = X[-win_len:, :] if n >= win_len else X.copy()
                        else:
                            keep = max(win_len * 2, win_len + int(fs))
                            buf = np.vstack((buf, X))[-keep:, :]
                    next_pull += EEG_PULL_PERIOD_S
                    if now - next_pull > EEG_PULL_PERIOD_S:
                        next_pull = now

                if global_idx >= next_gate and buf.shape[0] >= win_len and buf.shape[1] > 0:
                    win = buf[-win_len:, :]
                    E, alpha_p, theta_p, beta_p = engagement_from_window(win, fs)
                    self.norm.update(E)

                    if self.norm.Emax > self.norm.Emin:
                        Enorm = (E - self.norm.Emin) / (self.norm.Emax - self.norm.Emin)
                    else:
                        Enorm = 0.5
                    Enorm = max(0.0, min(1.0, Enorm))

                    sec = int(global_idx // fs)
                    if sec != last_sec:
                        last_sec = sec
                        await self._broadcast({
                            "type": "engagement",
                            "ts": int(time.time() * 1000),
                            "fs": fs,
                            "E": E,
                            "Enorm": Enorm,
                            "alpha": alpha_p,
                            "theta": theta_p,
                            "beta": beta_p,
                            "Emin": self._finite_or_none(self.norm.Emin),
                            "Emax": self._finite_or_none(self.norm.Emax),
                            "mode": self.mode,
                        })

                    while next_gate <= global_idx:
                        next_gate += GATE_STRIDE

                await asyncio.sleep(0.002)

        finally:
            try:
                board.stop_stream()
            except Exception:
                pass
            try:
                board.release_session()
            except Exception:
                pass

    def _finite_or_none(self, value: float) -> Optional[float]:
        return value if math.isfinite(value) else None

    def _parse_ws_addr(self, addr: str) -> tuple[str, int]:
        if not addr.startswith("ws://"):
            raise ValueError("WebSocket address must start with ws://")
        host_port = addr[len("ws://") :]
        if ":" not in host_port:
            raise ValueError("WebSocket address must include host:port")
        host, port_s = host_port.split(":", 1)
        return host, int(port_s)


async def main(serial_port: str, ws_addr: str, user_cmds: Optional[List[str]]) -> None:
    bridge = EEGBridge(serial_port, ws_addr, user_cmds)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, bridge._stop.set)  # type: ignore[attr-defined]
    await bridge.start()


def default_cyton_cmds() -> List[str]:
    return [
        "x1040010X","x2040010X","x3040010X","x4040010X",
        "x5040010X","x6040010X","x7040010X","x8040010X",
        "xQ040010X","xW040010X","xE040010X","xR040010X",
        "xT040010X","xY040010X","xU040010X","xI040010X",
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenBCI → engagement → WebSocket bridge")
    parser.add_argument(
        "--serial",
        default="/dev/cu.usbserial-DP05I34K",
        help="Serial port for OpenBCI Cyton/Daisy (default /dev/cu.usbserial-DP05I34K)",
    )
    parser.add_argument("--ws", default="ws://0.0.0.0:8765", help="WebSocket bind address (default ws://0.0.0.0:8765)")
    parser.add_argument("--cmd", action="append", default=[], help="board.config_board command (repeatable)")
    parser.add_argument("--apply-default-cyton-config", action="store_true", help="Send the 16 config commands from streaming.py")
    args = parser.parse_args()

    cmds: List[str] = list(args.cmd)
    if args.apply_default_cyton_config:
        cmds.extend(default_cyton_cmds())

    try:
        asyncio.run(main(args.serial, args.ws, cmds or None))
    except KeyboardInterrupt:
        pass
