"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { systemPrompt } from "../llm/prompt";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type RealtimeSessionInfo = {
  client_secret: string;
  model: string;
  voice: string;
  ice_servers?: RTCIceServer[];
};

type TranscriptChunk = {
  text: string;
  delta?: string;
  isFinal: boolean;
};

type TranscriptCallback = (chunk: TranscriptChunk) => void;

export function useRealtimeVoice(opts?: { onCompleted?: (finalText: string) => void; onSpeakingChange?: (speaking: boolean) => void; onTranscriptChunk?: TranscriptCallback }) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElRef = useRef<HTMLAudioElement | null>(null);
  const voiceRef = useRef<string>("verse");
  const assistantTextRef = useRef<string>("");
  const speakingRef = useRef(false);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioLevelRef = useRef(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantText, setAssistantText] = useState("");

  const resetState = () => {
    setAssistantText("");
    setError(null);
  };

  const setSpeaking = useCallback((value: boolean, delayMs = 0) => {
    if (value) {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      if (!speakingRef.current) {
        speakingRef.current = true;
        opts?.onSpeakingChange?.(true);
      }
      return;
    }

    const applyStop = () => {
      speakingTimeoutRef.current = null;
      if (speakingRef.current) {
        speakingRef.current = false;
        opts?.onSpeakingChange?.(false);
      }
    };

    if (delayMs > 0) {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
      speakingTimeoutRef.current = setTimeout(applyStop, delayMs);
    } else {
      applyStop();
    }
  }, [opts?.onSpeakingChange]);

  const attachAudioListeners = useCallback((audio: HTMLAudioElement | null) => {
    audioCleanupRef.current?.();
    if (!audio) {
      audioCleanupRef.current = null;
      return;
    }
    const handlePlaying = () => setSpeaking(true);
    const handlePause = () => setSpeaking(false, 400);
    const handleEnded = () => setSpeaking(false, 400);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audioCleanupRef.current = () => {
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [setSpeaking]);

  const setAudioElement = useCallback((el: HTMLAudioElement | null) => {
    remoteAudioElRef.current = el;
    attachAudioListeners(el);
  }, [attachAudioListeners]);

  const cleanupAnalyser = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    analyserRef.current = null;
    audioLevelRef.current = 0;
    setAudioLevel(0);
    setSpeaking(false);
  }, [setSpeaking]);

  const startAnalyser = useCallback((stream: MediaStream) => {
    const AudioContextCtor = typeof window !== "undefined"
      ? (window.AudioContext ?? window.webkitAudioContext)
      : undefined;
    if (!AudioContextCtor) return;

    cleanupAnalyser();

    const ctx = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = ctx;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch (error) {
      console.warn("Unable to create media stream source", error);
      return;
    }
    sourceRef.current = source;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    analyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const analyserNode = analyserRef.current;
      if (!analyserNode) return;
      const data = dataArray;
      analyserNode.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / data.length);
      const scaled = Math.min(1, rms * 4.5);
      const smoothed = audioLevelRef.current * 0.85 + scaled * 0.15;
      audioLevelRef.current = smoothed;
      setAudioLevel(smoothed);
      if (smoothed > 0.05) {
        setSpeaking(true);
      } else {
        setSpeaking(false, 220);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, [cleanupAnalyser, setSpeaking]);

  const connect = useCallback(async () => {
    if (connecting || connected) return;
    setConnecting(true);
    setError(null);

    try {
      resetState();

      const r = await fetch("/api/realtime/session", { method: "POST" });
      if (!r.ok) {
        let detail = "";
        try {
          detail = await r.text();
        } catch {
          // ignore
        }
        throw new Error(`Ephemeral session failed (${r.status})${detail ? `: ${detail}` : ""}`);
      }
      const info = (await r.json()) as RealtimeSessionInfo;
      if (!info?.client_secret) throw new Error("No client_secret returned");
      voiceRef.current = info.voice || voiceRef.current;

      const iceServers = Array.isArray(info?.ice_servers) && info.ice_servers.length > 0
        ? info.ice_servers
        : [{ urls: "stun:stun.l.google.com:19302" }];

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      // Ensure downstream audio track is negotiated for assistant playback
      pc.addTransceiver("audio", { direction: "recvonly" });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const [audioTrack] = stream.getAudioTracks();
      if (!audioTrack) throw new Error("No microphone track available");
      pc.addTrack(audioTrack, stream);

      pc.ontrack = (event) => {
        const audioEl = remoteAudioElRef.current;
        if (!audioEl) return;
        const inbound = event.streams?.[0] ?? new MediaStream([event.track]);
        audioEl.srcObject = inbound;
        audioEl.muted = false;
        audioEl.play().catch(() => {
          // requires user gesture in some browsers
        });
        attachAudioListeners(audioEl);
        startAnalyser(inbound);
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        setConnected(true);
        setConnecting(false);
      };

      dc.onclose = () => {
        setConnected(false);
        resetState();
      };

      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          console.debug("[realtime] event", msg.type, msg);
          if (msg.type === "response.output_text.delta") {
            const delta = typeof msg.delta === "string"
              ? msg.delta
              : Array.isArray(msg.delta)
                ? msg.delta.join("")
                : "";
            if (delta) {
              assistantTextRef.current += delta;
              setAssistantText((t) => t + delta);
              setSpeaking(true);
            }
          }
          if (msg.type === "response.output_text.done") {
            const text = typeof msg.text === "string"
              ? msg.text
              : Array.isArray(msg.text)
                ? msg.text.join("")
                : "";
            if (text) {
              assistantTextRef.current = text;
              setAssistantText(text);
              setSpeaking(false, 500);
            }
          }
          if (msg.type === "response.audio_transcript.delta") {
            const delta = typeof msg.delta === "string"
              ? msg.delta
              : Array.isArray(msg.delta)
                ? msg.delta.join("")
                : "";
            if (delta) {
              assistantTextRef.current += delta;
              setAssistantText((t) => t + delta);
              opts?.onTranscriptChunk?.({ text: assistantTextRef.current, delta, isFinal: false });
              setSpeaking(true);
            }
          }
          if (msg.type === "response.audio_transcript.done") {
            const transcript = typeof msg.transcript === "string"
              ? msg.transcript
              : Array.isArray(msg.transcript)
                ? msg.transcript.join("")
                : "";
            if (transcript) {
              assistantTextRef.current = transcript;
              setAssistantText(transcript);
              opts?.onTranscriptChunk?.({ text: transcript, isFinal: true });
              setSpeaking(false, 500);
            }
          }
          if (msg.type === "response.audio.delta") {
            setSpeaking(true);
          }
          if (msg.type === "response.audio.done") {
            setSpeaking(false, 500);
          }
          if (msg.type === "response.completed" || msg.type === "response.done") {
            const finalText = assistantTextRef.current;
            opts?.onCompleted?.(finalText);
            setSpeaking(false, 500);
          }
        } catch (err) {
          console.warn("Unhandled realtime event", err);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const url = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(info.model)}`;
      const sdpResponse = await fetch(url, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${info.client_secret}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
      });
      if (!sdpResponse.ok) throw new Error(`SDP answer failed (${sdpResponse.status})`);
      const answer = { type: "answer" as const, sdp: await sdpResponse.text() };
      await pc.setRemoteDescription(answer);
    } catch (e: any) {
      console.error("realtime connect error", e);
      setError(e?.message || "Failed to connect realtime session");
      setConnecting(false);
      setConnected(false);
      try { dcRef.current?.close(); } catch {}
      dcRef.current = null;
      try { pcRef.current?.close(); } catch {}
      pcRef.current = null;
      try { micStreamRef.current?.getTracks().forEach((track) => track.stop()); } catch {}
      micStreamRef.current = null;
    }
  }, [connecting, connected]);

  const disconnect = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    dcRef.current = null;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    try { micStreamRef.current?.getTracks().forEach((track) => track.stop()); } catch {}
    micStreamRef.current = null;
    setConnected(false);
    resetState();
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    setSpeaking(false);
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    cleanupAnalyser();
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, [cleanupAnalyser, setSpeaking]);

  const requestResponse = useCallback((engagement?: number, moodMode?: boolean) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;

    const hiddenLine = moodMode && typeof engagement === "number"
      ? `\n\nNormalized engagement score (0-1): ${engagement.toFixed(3)}`
      : "";

    setAssistantText("");
    assistantTextRef.current = "";
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    setSpeaking(false);

    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: systemPrompt + hiddenLine,
      },
    };
    dc.send(JSON.stringify(sessionUpdate));

    const responseCreate = {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        audio: { voice: voiceRef.current },
      },
    };
    dc.send(JSON.stringify(responseCreate));
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    connecting,
    connected,
    error,
    assistantText,
    setAudioElement,
    connect,
    disconnect,
    requestResponse,
    audioLevel,
  };
}
