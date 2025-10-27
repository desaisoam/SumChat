"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const WINDOW_SAMPLES = 15; // assume ~1 Hz updates

export function useEngagementWindow() {
  const valuesRef = useRef<number[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [tick, setTick] = useState(0);

  const push = useCallback((value: number) => {
    if (frozen) return;
    const next = valuesRef.current.concat(value);
    while (next.length > WINDOW_SAMPLES) next.shift();
    valuesRef.current = next;
    setTick((t) => t + 1);
  }, [frozen]);

  const average = useMemo(() => {
    const arr = valuesRef.current;
    if (!arr.length) return undefined;
    return arr.reduce((acc, val) => acc + val, 0) / arr.length;
  }, [tick]);

  const freeze = () => setFrozen(true);
  const unfreeze = () => setFrozen(false);

  return {
    frozen,
    freeze,
    unfreeze,
    avg15s: {
      value: average,
      push,
    },
  };
}
