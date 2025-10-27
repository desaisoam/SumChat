"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type EngagementPacket = {
  type: "engagement";
  ts: number;
  fs: number;
  E?: number;
  Enorm?: number;
  alpha?: number;
  theta?: number;
  beta?: number;
  Emin?: number | null;
  Emax?: number | null;
  mode: "normal" | "relax" | "mental";
};

type CalibrationMessage = {
  type: "calibration";
  mode: "normal" | "relax" | "mental";
  Emin?: number | null;
  Emax?: number | null;
};

type Incoming = EngagementPacket | CalibrationMessage | { type: "hello"; mode: EngagementPacket["mode"] };

export function useEEG() {
  const url = process.env.NEXT_PUBLIC_EEG_WS_URL || "ws://localhost:8765";
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState<EngagementPacket | undefined>(undefined);
  const [mode, setModeState] = useState<EngagementPacket["mode"]>("normal");

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe" }));
    };
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Incoming;
        if (payload.type === "engagement") {
          setLatest(payload);
          setModeState(payload.mode);
        } else if (payload.type === "calibration" || payload.type === "hello") {
          if (payload.mode) setModeState(payload.mode);
        }
      } catch (err) {
        console.warn("Invalid EEG packet", err);
      }
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }, [url]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const setMode = useCallback((next: EngagementPacket["mode"]) => {
    wsRef.current?.send(JSON.stringify({ type: "set_mode", mode: next }));
    setModeState(next);
  }, []);

  const resetNorm = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "reset_norm" }));
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  return { latest, connected, connect, disconnect, setMode, resetNorm, mode };
}

