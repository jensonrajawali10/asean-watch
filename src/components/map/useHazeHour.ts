// Forecast hour state for the haze scrubber (App holds it). The anchor ("now") is the wall clock for a
// live model run and the capture time for the bundled snapshot, so the window always has data.
import { useCallback, useMemo, useState } from 'react';
import { aqRange, forecastAnchorMs, forecastSteps } from '../../lib/airQuality';
import type { AirQualityData, ForecastSteps } from '../../lib/airQuality';

export interface HazeHour {
  steps: ForecastSteps;
  index: number;
  setIndex: (index: number) => void;
  /** ISO 8601 UTC time of the selected step (pass to HazeLayerController as timeISO). */
  timeISO: string;
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
  return { steps, index, setIndex, timeISO: steps.times[index] };
}
