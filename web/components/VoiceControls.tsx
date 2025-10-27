"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeVoice } from "../lib/voice/useRealtimeVoice";
import { useSpeechRecognition } from "../lib/voice/useSpeechRecognition";
import { Button } from "./ui/button";

type Props = {
  moodMode: boolean;
  frozenEngagement?: number;
  onTalkingFreeze: () => void;
  onResponseDone: () => void;
  onVoiceTurnComplete?: (payload: { userTranscript?: string; assistantText?: string }) => void;
  onAssistantSpeakingChange?: (speaking: boolean) => void;
  onAssistantLevelChange?: (level: number) => void;
  onAssistantTranscriptChange?: (chunk: { text: string; delta?: string; isFinal: boolean }) => void;
};

export function VoiceControls({ moodMode, frozenEngagement, onTalkingFreeze, onResponseDone, onVoiceTurnComplete, onAssistantSpeakingChange, onAssistantLevelChange, onAssistantTranscriptChange }: Props) {
  const {
    supported: speechSupported,
    listening,
    transcript: liveTranscript,
    error: speechError,
    start: startSpeech,
    stop: stopSpeech,
    reset: resetSpeech,
  } = useSpeechRecognition();

  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [voiceTurnActive, setVoiceTurnActive] = useState(false);
  const assistantTextRef = useRef("");

  useEffect(() => {
    if (!listening && liveTranscript) {
      setLastTranscript(liveTranscript);
    }
  }, [listening, liveTranscript]);

  const handleRealtimeCompleted = useCallback((finalAssistantText: string) => {
    if (speechSupported) {
      stopSpeech();
    }
    if (voiceTurnActive && onVoiceTurnComplete) {
      const userTranscript = (liveTranscript || lastTranscript).trim();
      const assistantTranscript = (finalAssistantText || assistantTextRef.current).trim();
      if (userTranscript || assistantTranscript) {
        console.debug("[voice] turn complete", { userTranscript, assistantTranscript });
        onVoiceTurnComplete({
          userTranscript: userTranscript || undefined,
          assistantText: assistantTranscript || undefined,
        });
      }
    }
    setVoiceTurnActive(false);
    onAssistantSpeakingChange?.(false);
    onResponseDone();
  }, [speechSupported, stopSpeech, voiceTurnActive, onVoiceTurnComplete, liveTranscript, lastTranscript, onResponseDone, onAssistantSpeakingChange]);

  const {
    connecting,
    connected,
    error,
    assistantText,
    setAudioElement,
    connect,
    disconnect,
    requestResponse,
    audioLevel,
  } = useRealtimeVoice({
    onCompleted: handleRealtimeCompleted,
    onSpeakingChange: onAssistantSpeakingChange,
    onTranscriptChunk: (chunk) => {
      if (!chunk.text.trim()) {
        onAssistantTranscriptChange?.(chunk);
        return;
      }
      onAssistantTranscriptChange?.(chunk);
      if (chunk.isFinal) {
        assistantTextRef.current = chunk.text;
      }
    },
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    setAudioElement(audioRef.current);
  }, [setAudioElement]);

  useEffect(() => {
    if (!connected) {
      stopSpeech();
    }
  }, [connected, stopSpeech]);

  const handleAsk = () => {
    if (!connected) return;
    onTalkingFreeze();
    if (speechSupported) {
      resetSpeech();
      setLastTranscript("");
      startSpeech();
    }
    setVoiceTurnActive(true);
    onAssistantSpeakingChange?.(true);
    onAssistantTranscriptChange?.({ text: "", isFinal: false });
    requestResponse(frozenEngagement, moodMode);
  };

  useEffect(() => {
    assistantTextRef.current = assistantText;
  }, [assistantText]);

  useEffect(() => {
    onAssistantLevelChange?.(audioLevel);
  }, [audioLevel, onAssistantLevelChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          onClick={connected ? disconnect : connect}
          disabled={connecting}
          size="sm"
          variant={connected ? "outline" : "default"}
        >
          {connected ? "Disconnect Voice" : connecting ? "Connecting…" : "Connect Voice"}
        </Button>
        <Button onClick={handleAsk} disabled={!connected} size="sm">
          Ask (voice)
        </Button>
        <span style={{ fontSize: 12, color: "#6B7280" }}>
          {connected ? "Voice session active" : "Voice session idle"}
        </span>
      </div>

      <audio ref={audioRef} autoPlay />

      {error && (
        <div style={{ color: "#b91c1c", fontSize: 12 }}>Voice error: {error}</div>
      )}

      {speechError && (
        <div style={{ color: "#b45309", fontSize: 12 }}>Speech recognition: {speechError}</div>
      )}
    </div>
  );
}
