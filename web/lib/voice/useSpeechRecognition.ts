"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionEvent = {
  resultIndex: number;
  results: Array<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type RecognitionErrorEvent = {
  error?: string;
};

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => RecognitionInstance;
    SpeechRecognition?: new () => RecognitionInstance;
  }
}

function getSpeechRecognitionConstructor(): (new () => RecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return Ctor ?? null;
}

export function useSpeechRecognition() {
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const finalChunksRef = useRef<string[]>([]);

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (!text) continue;
        if (result.isFinal) {
          finalChunksRef.current.push(text.trim());
        } else {
          interim = `${interim} ${text}`.trim();
        }
      }
      const full = `${finalChunksRef.current.join(" ")} ${interim}`.trim();
      setTranscript(full);
    };

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = (event) => {
      setError(event?.error ?? "Speech recognition error");
    };

    recognitionRef.current = recognition;
    setSupported(true);

    return () => {
      try {
        recognition.onresult = null;
        recognition.onstart = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {
        // ignore cleanup failures
      }
      recognitionRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    finalChunksRef.current = [];
    setTranscript("");
    setError(null);
  }, []);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("Speech recognition not supported in this browser");
      return false;
    }
    try {
      recognition.stop();
    } catch {
      // ignore
    }
    reset();
    try {
      recognition.start();
      return true;
    } catch (err: any) {
      // If already started, try to recover
      if (err?.name === "InvalidStateError") {
        try {
          recognition.stop();
          recognition.start();
          return true;
        } catch (innerErr: any) {
          setError(innerErr?.message ?? "Unable to start speech recognition");
          return false;
        }
      }
      setError(err?.message ?? "Unable to start speech recognition");
      return false;
    }
  }, [reset]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  }, []);

  return {
    supported,
    listening,
    transcript,
    error,
    start,
    stop,
    reset,
  };
}
