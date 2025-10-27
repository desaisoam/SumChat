"use client";

import { useCallback, useEffect, useState } from "react";
import { Thread } from "../components/Thread";
import { BrainWidget } from "../components/BrainWidget";
import { EEGDebugPanel } from "../components/EEGDebugPanel";
import { VoiceControls } from "../components/VoiceControls";
import { useEEG } from "../lib/eeg/ws";
import { useEngagementWindow } from "../lib/eeg/engagement";

export default function HomePage() {
  const { latest, connected, connect, disconnect, setMode, resetNorm, mode } = useEEG();
  const { avg15s, frozen, freeze, unfreeze } = useEngagementWindow();
  const { value: avg15Value, push } = avg15s;

  const [moodMode, setMoodMode] = useState(true);
  const [debugMode, setDebugMode] = useState(true);
  const [voiceTurns, setVoiceTurns] = useState<Array<{ id: string; userTranscript?: string; assistantText?: string }>>([]);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [assistantLevel, setAssistantLevel] = useState(0);
  useEffect(() => {
    if (latest?.Enorm != null && !frozen) {
      push(latest.Enorm);
    }
  }, [latest, push, frozen]);

  const handleVoiceTurnComplete = useCallback(async ({ userTranscript, assistantText }: { userTranscript?: string; assistantText?: string }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setVoiceTurns((prev) => prev.concat({ id, userTranscript, assistantText }));

    if (assistantText) {
      return;
    }

    if (userTranscript) {
      try {
        const history = voiceTurns.flatMap((turn) => {
          const entries: Array<{ role: "user" | "assistant"; content: string }> = [];
          if (turn.userTranscript) entries.push({ role: "user", content: turn.userTranscript });
          if (turn.assistantText) entries.push({ role: "assistant", content: turn.assistantText });
          return entries;
        });

        const body: Record<string, unknown> = {
          messages: history.concat({ role: "user", content: userTranscript }),
        };
        if (moodMode && typeof avg15Value === "number") {
          body.engagement = avg15Value;
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          console.warn("voice fallback /api/chat failed", response.status);
          return;
        }

        const data = await response.json();
        const text = typeof data?.content === "string"
          ? data.content
          : Array.isArray(data?.content)
            ? data.content.join("\n")
            : JSON.stringify(data);

        setVoiceTurns((prev) => prev.map((turn) => (
          turn.id === id
            ? { ...turn, assistantText: text }
            : turn
        )));
        console.debug("[voice] fallback assistant text", text.replace(/\s+/g, " ").trim());
      } catch (err) {
        console.warn("voice fallback error", err);
      }
    }
  }, [voiceTurns, moodMode, avg15Value]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100vh" }}>
      <aside style={{ borderRight: "1px solid #e1e5eb", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0 }}>SumChat</h2>
        <BrainWidget
          connected={connected}
          onConnect={connect}
          onDisconnect={disconnect}
          mode={mode}
          onModeChange={setMode}
          onResetNorm={resetNorm}
          moodMode={moodMode}
          setMoodMode={setMoodMode}
          debugMode={debugMode}
          setDebugMode={setDebugMode}
          avg15={avg15Value}
          frozen={frozen}
          onFreeze={freeze}
          onUnfreeze={unfreeze}
          latest={latest}
        />
        {debugMode && <EEGDebugPanel latest={latest} avg15={avg15Value} />}
      </aside>
      <main style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #dde1e7", background: "white" }}>
          <VoiceControls
            moodMode={moodMode}
            frozenEngagement={avg15Value}
            onTalkingFreeze={freeze}
          onResponseDone={unfreeze}
          onVoiceTurnComplete={handleVoiceTurnComplete}
          onAssistantSpeakingChange={setAssistantSpeaking}
          onAssistantLevelChange={setAssistantLevel}
        />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Thread assistantSpeaking={assistantSpeaking} assistantLevel={assistantLevel} />
        </div>
      </main>
    </div>
  );
}
