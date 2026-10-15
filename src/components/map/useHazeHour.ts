// Forecast hour state for the one map scrubber (App holds it). The anchor ("now") is the wall clock for a
// live model run and the capture time for the bundled snapshot, so the window always has data. Play lives
// here too, so anything (the scrubber, the volcano card's "Play ash scenario") can start the same timeline.
// Play advances one 3-hourly step per tick and stops at the end; under prefers-reduced-motion it is slower.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aqRange, forecastAnchorMs, forecastSteps } from '../../lib/airQuality';
import type { AirQualityData, ForecastSteps } from '../../lib/airQuality';

export interface HazeHour {
  steps: ForecastSteps;
  index: number;
  setIndex: (index: number) => void;
  /** ISO 8601 UTC time of the selected step (pass to HazeLayerController as timeISO). */
  timeISO: string;
  playing: boolean;
  /** Start or stop playback, optionally from a step. Starting at the last step rewinds to the first. */
  setPlaying: (playing: boolean, from?: number) => void;
  /** Milliseconds per step while playing (for tweening between steps). */
  stepMs: number;
}

export const PLAY_STEP_MS = 900;
export const PLAY_STEP_MS_REDUCED = 2000;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Next index while playing, or null at the end (playback stops; it never loops on its own). */
export function nextPlayIndex(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

export function useHazeHour(airQuality: AirQualityData | null): HazeHour {
  // A live run was fetched moments ago (30 min cache), so its retrieval time stands in for "now"; before
  // any data arrives the mount time does.
  const [mountMs] = useState(() => Date.now());
  const steps = useMemo(() => {
    const clock = airQuality ? Date.parse(airQuality.retrievedAt) : mountMs;
    return forecastSteps(forecastAnchorMs(airQuality, Number.isFinite(clock) ? clock : mountMs), aqRange(airQuality));
  }, [airQuality, mountMs]);
  // The chosen step is kept by time, so a new model run keeps the same hour when it still exists.
  const [chosen, setChosen] = useState<string | null>(null);
  const found = chosen === null ? -1 : steps.times.indexOf(chosen);
  const index = found >= 0 ? found : steps.nowIndex;
  const setIndex = useCallback(
    (i: number) => setChosen(steps.times[Math.max(0, Math.min(steps.times.length - 1, Math.round(i)))] ?? null),
    [steps],
  );

  const [playing, setPlayingState] = useState(false);
  const [stepMs] = useState(() => (reducedMotion() ? PLAY_STEP_MS_REDUCED : PLAY_STEP_MS));
  const indexRef = useRef(index);
  indexRef.current = index;
  const n = steps.times.length;

  const setPlaying = useCallback(
    (on: boolean, from?: number) => {
      if (on && n < 2) return;
      if (on && from !== undefined) {
        indexRef.current = from;
        setIndex(from);
      } else if (on && indexRef.current >= n - 1) {
        setIndex(0);
      }
      setPlayingState(on);
    },
    [n, setIndex],
  );

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = nextPlayIndex(indexRef.current, n);
      if (next === null) setPlayingState(false);
      else setIndex(next);
    }, stepMs);
    return () => window.clearInterval(id);
  }, [playing, n, setIndex, stepMs]);

  // Stop at the end (the interval sees the last step on its next tick; this catches a manual jump there).
  useEffect(() => {
    if (playing && index >= n - 1) {
      const t = window.setTimeout(() => setPlayingState(false), stepMs);
      return () => window.clearTimeout(t);
    }
  }, [playing, index, n, stepMs]);

  return { steps, index, setIndex, timeISO: steps.times[index], playing, setPlaying, stepMs };
}
