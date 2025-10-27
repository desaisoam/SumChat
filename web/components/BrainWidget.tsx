"use client";

import { EngagementPacket } from "../lib/eeg/ws";
import { Button } from "./ui/button";

type Props = {
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  mode: EngagementPacket["mode"];
  onModeChange: (mode: EngagementPacket["mode"]) => void;
  onResetNorm: () => void;
  moodMode: boolean;
  setMoodMode: (value: boolean) => void;
  debugMode: boolean;
  setDebugMode: (value: boolean) => void;
  avg15?: number;
  frozen: boolean;
  onFreeze: () => void;
  onUnfreeze: () => void;
  latest?: EngagementPacket;
};

export function BrainWidget(props: Props) {
  const {
    connected,
    onConnect,
    onDisconnect,
    mode,
    onModeChange,
    onResetNorm,
    moodMode,
    setMoodMode,
    debugMode,
    setDebugMode,
    avg15,
    frozen,
    onFreeze,
    onUnfreeze,
    latest,
  } = props;

  const toggleMood = () => setMoodMode(!moodMode);
  const toggleDebug = () => setDebugMode(!debugMode);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px",
        borderRadius: 16,
        border: "1px solid #E5E7EB",
        background: "#FFFFFF",
        boxShadow: "0 10px 30px -24px rgba(15, 23, 42, 0.45)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            onClick={connected ? onDisconnect : onConnect}
            size="sm"
            variant={connected ? "outline" : "default"}
          >
            {connected ? "Disconnect Headset" : "Connect Headset"}
          </Button>
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value as EngagementPacket["mode"])}
            style={{
              appearance: "none",
              borderRadius: 9999,
              border: "1px solid rgba(99, 102, 241, 0.26)",
              padding: "0.5rem 1.1rem",
              fontSize: "0.9rem",
              fontWeight: 500,
              background: "#F9FAFB url('data:image/svg+xml;utf8,<svg fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M7 10l5 5 5-5\" stroke=\"%236B7280\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>') no-repeat right 0.9rem center / 14px",
              color: "#111827",
              minHeight: "2.4rem",
            }}
          >
            <option value="normal">Normal</option>
            <option value="relax">Calibrate · Relax</option>
            <option value="mental">Calibrate · Focus</option>
          </select>
          <Button onClick={onResetNorm} size="sm" variant="outline">
            Reset Norm
          </Button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={toggleMood} size="sm" variant={moodMode ? "default" : "outline"}>
            Mood Mode {moodMode ? "On" : "Off"}
          </Button>
          <Button onClick={toggleDebug} size="sm" variant={debugMode ? "default" : "outline"}>
            Debug Mode {debugMode ? "On" : "Off"}
          </Button>
          <Button
            onClick={frozen ? onUnfreeze : onFreeze}
            size="sm"
            variant={frozen ? "outline" : "default"}
          >
            {frozen ? "Unfreeze 15s Avg" : "Freeze 15s Avg"}
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 12,
          color: "#4B5563",
        }}
      >
        <div>
          <strong style={{ color: "#111827" }}>15s avg:</strong>{" "}
          {avg15 != null ? avg15.toFixed(3) : "—"}
        </div>
        <div>
          <strong style={{ color: "#111827" }}>Latest Enorm:</strong>{" "}
          {latest?.Enorm != null ? latest.Enorm.toFixed(3) : "—"}
        </div>
        <div>
          <strong style={{ color: "#111827" }}>Emin:</strong>{" "}
          {latest?.Emin != null ? latest.Emin.toFixed(4) : "—"}
        </div>
        <div>
          <strong style={{ color: "#111827" }}>Emax:</strong>{" "}
          {latest?.Emax != null ? latest.Emax.toFixed(4) : "—"}
        </div>
      </div>
    </div>
  );
}
