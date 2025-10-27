"use client";

import { useEffect, type CSSProperties } from "react";

const STYLE_ID = "voice-visualizer-style";

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes voiceWaveOuter {
      0%, 100% { transform: scale(0.95); opacity: 0.25; }
      50% { transform: scale(1.12); opacity: 0.7; }
    }
    @keyframes voiceWaveMiddle {
      0%, 100% { transform: scale(0.92); opacity: 0.35; }
      50% { transform: scale(1.05); opacity: 0.85; }
    }
    @keyframes voiceWaveInner {
      0%, 100% { transform: scale(0.88); opacity: 0.45; }
      50% { transform: scale(0.96); opacity: 0.95; }
    }
  `;
  document.head.appendChild(style);
}

type Props = {
  speaking: boolean;
  level?: number;
  size?: number;
};

export function VoiceVisualizer({ speaking, level = 0, size = 260 }: Props) {
  useEffect(() => {
    ensureStyles();
  }, []);

  const layers = [
    {
      name: "voiceWaveOuter",
      borderWidth: 1.2,
      duration: 3,
      minScale: 0.95,
      idleMax: 0.99,
      activeMax: 1.14,
      minOpacity: 0.2,
      idleOpacity: 0.35,
      activeOpacity: 0.72,
    },
    {
      name: "voiceWaveMiddle",
      borderWidth: 1.6,
      duration: 2.4,
      minScale: 0.92,
      idleMax: 0.97,
      activeMax: 1.06,
      minOpacity: 0.28,
      idleOpacity: 0.38,
      activeOpacity: 0.85,
    },
    {
      name: "voiceWaveInner",
      borderWidth: 2,
      duration: 1.8,
      minScale: 0.88,
      idleMax: 0.94,
      activeMax: 0.99,
      minOpacity: 0.35,
      idleOpacity: 0.45,
      activeOpacity: 0.92,
    },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {layers.map((layer, idx) => {
        const amplitude = Math.min(1, Math.max(0, level));
        const scaleMax = layer.minScale + amplitude * (layer.activeMax - layer.minScale);
        const opacityMax = layer.minOpacity + amplitude * (layer.activeOpacity - layer.minOpacity);
        
        const style: CSSProperties = {
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `${layer.borderWidth}px solid rgba(0,0,0,0.7)`,
          animation: `${layer.name} ${layer.duration}s ease-in-out infinite`,
          animationPlayState: amplitude > 0.01 ? "running" : "paused",
          transition: "opacity 0.3s ease, transform 0.3s ease",
          opacity: opacityMax,
        };

        if (layer.name === "voiceWaveOuter") {
          (style as any)["--outer-min"] = String(layer.minScale);
          (style as any)["--outer-max"] = String(scaleMax);
          (style as any)["--outer-opacity-min"] = String(layer.minOpacity);
          (style as any)["--outer-opacity-max"] = String(opacityMax);
        } else if (layer.name === "voiceWaveMiddle") {
          (style as any)["--middle-min"] = String(layer.minScale);
          (style as any)["--middle-max"] = String(scaleMax);
          (style as any)["--middle-opacity-min"] = String(layer.minOpacity);
          (style as any)["--middle-opacity-max"] = String(opacityMax);
        } else {
          (style as any)["--inner-min"] = String(layer.minScale);
          (style as any)["--inner-max"] = String(scaleMax);
          (style as any)["--inner-opacity-min"] = String(layer.minOpacity);
          (style as any)["--inner-opacity-max"] = String(opacityMax);
        }

        if (amplitude <= 0.01) {
          style.transform = `scale(${layer.minScale})`;
        }

        return <div key={idx} style={style} />;
      })}
      <div
        style={{
          position: "absolute",
          width: size * 0.55,
          height: size * 0.55,
          borderRadius: "50%",
          background: level > 0.02 ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.05)",
          transition: "background 0.4s ease",
        }}
      />
    </div>
  );
}
