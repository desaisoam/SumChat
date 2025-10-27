"use client";

import { EngagementPacket } from "../lib/eeg/ws";

export function EEGDebugPanel({ latest, avg15 }: { latest?: EngagementPacket; avg15?: number }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>EEG Debug</div>
      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
        <div>Timestamp: {latest?.ts ?? "--"}</div>
        <div>fs: {latest?.fs ?? "--"}</div>
        <div>E: {latest?.E != null ? latest.E.toFixed(4) : "--"}</div>
        <div>Enorm: {latest?.Enorm != null ? latest.Enorm.toFixed(3) : "--"}</div>
        <div>α: {latest?.alpha != null ? latest.alpha.toExponential(3) : "--"}</div>
        <div>θ: {latest?.theta != null ? latest.theta.toExponential(3) : "--"}</div>
        <div>β: {latest?.beta != null ? latest.beta.toExponential(3) : "--"}</div>
        <div>Mode: {latest?.mode ?? "--"}</div>
        <div>15s avg: {avg15 != null ? avg15.toFixed(3) : "--"}</div>
      </div>
    </div>
  );
}

