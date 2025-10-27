"use client";

import { VoiceVisualizer } from "./VoiceVisualizer";

type Props = {
  assistantSpeaking?: boolean;
  assistantLevel?: number;
};

export function Thread({ assistantSpeaking, assistantLevel }: Props) {
  return (
    <div
      style={{
        flex: 1,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8f9fb",
      }}
    >
      <VoiceVisualizer speaking={!!assistantSpeaking} level={assistantLevel} size={260} />
    </div>
  );
}

