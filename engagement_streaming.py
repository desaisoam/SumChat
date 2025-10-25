#!/usr/bin/env python3
import time, json, os, numpy as np
from time import monotonic_ns
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds

# ====================== config ======================
EEG_PULL_PERIOD_S = 0.200       # pull cadence from BrainFlow ring buffer
WINDOW_S          = 1.0         # bandpower window length
GATE_STRIDE       = 256         # compute when global_idx crosses these multiples
PERSIST_PATH      = os.path.join(os.path.dirname(__file__), "engagement_norm.json")
SERIAL_PORT       = "/dev/cu.usbserial-DP05I34K"  # <- change me if needed
USER_CMDS = [
    "x1040010X","x2040010X","x3040010X","x4040010X",
    "x5040010X","x6040010X","x7040010X","x8040010X",
    "xQ040010X","xW040010X","xE040010X","xR040010X",
    "xT040010X","xY040010X","xU040010X","xI040010X"
]
# Bands (Hz)
THETA = (4.0, 7.0)
ALPHA = (7.0, 11.0)
BETA  = (11.0, 20.0)
# ====================================================

def load_norm_state(path):
    try:
        with open(path, "r") as f:
            d = json.load(f)
            return float(d.get("Emin", float("inf"))), float(d.get("Emax", float("-inf")))
    except Exception:
        return float("inf"), float("-inf")

def save_norm_state(path, Emin, Emax):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"Emin": Emin, "Emax": Emax, "updated_ns": monotonic_ns()}, f)
    os.replace(tmp, path)

def brainflow_init(serial_port, user_cmds):
    BoardShim.enable_dev_board_logger()
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

def get_new_eeg(board, board_id, cached_ch):
    if cached_ch[0] is None:
        cached_ch[0] = BoardShim.get_eeg_channels(board_id)
    data = board.get_board_data()  # pops everything available
    if data.size == 0:
        return np.empty((0, 0), dtype=np.float32)
    eeg = data[cached_ch[0], :].T.astype(np.float32)  # (n, C)
    return eeg

def bandpower_welchish(x, fs, f_lo, f_hi):
    """
    Minimal, fast bandpower: Hanning window -> rFFT -> integrate PSD over band.
    Returns power scalar. Works fine for ratios; absolute scale cancels.
    """
    n = len(x)
    if n == 0:
        return 0.0
    w = np.hanning(n)
    xw = (x - x.mean()) * w
    freqs = np.fft.rfftfreq(n, d=1.0/fs)
    spec = np.fft.rfft(xw)
    psd = (np.abs(spec) ** 2) / (np.sum(w**2) * fs)  # classic normalization
    idx = (freqs >= f_lo) & (freqs < f_hi)
    if not np.any(idx):
        return 0.0
    return np.trapz(psd[idx], freqs[idx])

def engagement_from_window(win, fs):
    """
    win: (samples, channels)
    Compute bandpowers averaged across channels, then E and return (E, a, t, b).
    """
    if win.size == 0:
        return 0.0, 0.0, 0.0, 0.0
    theta_p = 0.0; alpha_p = 0.0; beta_p = 0.0
    C = win.shape[1]
    for c in range(C):
        sig = win[:, c]
        theta_p += bandpower_welchish(sig, fs, *THETA)
        alpha_p += bandpower_welchish(sig, fs, *ALPHA)
        beta_p  += bandpower_welchish(sig, fs, *BETA)
    theta_p /= C; alpha_p /= C; beta_p /= C
    denom = (alpha_p + theta_p)
    E = beta_p / denom if denom > 1e-12 else 0.0
    return float(E), float(alpha_p), float(theta_p), float(beta_p)

def run_engagement(serial_port=SERIAL_PORT, user_cmds=USER_CMDS):
    board, bid = brainflow_init(serial_port, user_cmds)
    try:
        fs = BoardShim.get_sampling_rate(bid)
        eeg_ch = [None]  # lazy cache
        win_len = int(round(WINDOW_S * fs))
        if win_len < 8:
            raise RuntimeError("Window too short for PSD calculation.")

        # ring buffer holds slightly more than 1s
        buf = np.empty((0, 0), dtype=np.float32)
        global_idx = 0
        next_gate = GATE_STRIDE

        Emin, Emax = load_norm_state(PERSIST_PATH)
        print(f"[init] fs={fs}Hz, win={win_len} samples, gate={GATE_STRIDE}, "
              f"Emin={Emin if Emin!=float('inf') else 'inf'}, "
              f"Emax={Emax if Emax!=float('-inf') else '-inf'}")

        next_pull = time.monotonic()

        last_print_sec = -1
        while True:
            now = time.monotonic()

            # pull EEG
            if now >= next_pull:
                X = get_new_eeg(board, bid, eeg_ch)  # (n, C)
                n = X.shape[0]
                if n > 0:
                    global_idx += n
                    if buf.size == 0:
                        buf = X[-win_len:, :] if n >= win_len else X.copy()
                    else:
                        buf = np.vstack([buf, X])[-max(win_len*2, win_len+fs):, :]
                next_pull += EEG_PULL_PERIOD_S
                if now - next_pull > EEG_PULL_PERIOD_S:
                    next_pull = now  # catch up if delayed

            # compute engagement when we cross the 256-sample gate
            if global_idx >= next_gate and buf.shape[0] >= win_len and buf.shape[1] > 0:
                win = buf[-win_len:, :]  # last 1s
                E, a, t, b = engagement_from_window(win, fs)

                # update min/max + persist
                updated = False
                if E < Emin:
                    Emin = E; updated = True
                if E > Emax:
                    Emax = E; updated = True
                if updated:
                    save_norm_state(PERSIST_PATH, Emin, Emax)

                # normalize (clamp)
                if Emax > Emin:
                    Enorm = (E - Emin) / (Emax - Emin)
                else:
                    Enorm = 0.5  # first value(s); arbitrary midpoint

                Enorm = max(0.0, min(1.0, Enorm))

                # print once per second-ish (cosmetic)
                sec = int((global_idx // fs))
                if sec != last_print_sec:
                    last_print_sec = sec
                    print(f"[t~{sec:4d}s] E={E:.4f}  Enorm={Enorm:.3f}  "
                          f"(β={b:.3e}, α={a:.3e}, θ={t:.3e})  "
                          f"[Emin={Emin:.4f}, Emax={Emax:.4f}]")

                # schedule next gate
                while next_gate <= global_idx:
                    next_gate += GATE_STRIDE

            # tiny sleep to keep CPU sane
            time.sleep(0.002)

    except KeyboardInterrupt:
        print("\n[stop] Ctrl-C")
    finally:
        try:
            board.stop_stream()
        except Exception:
            pass
        try:
            board.release_session()
        except Exception:
            pass

if __name__ == "__main__":
    run_engagement()
