// STUB: owned by the logic builder. Signatures are the contract; bodies get replaced.
import type { DriftAssessment, Incident, NeaContext, NeaStationWind, WindSummary } from '../types';

export const NEA_RANGE_KM = 600;

export interface NeaLoadResult {
  context: NeaContext | null;
  /** True when live fetch failed and the bundled snapshot was used. */
  fellBack: boolean;
  /** Readable reason the live fetch failed, or null. */
  error: string | null;
}

/** Live first (5 s timeout), then the bundled snapshot. Never throws. */
export async function loadNeaContext(opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<NeaLoadResult> {
  void opts;
  return { context: null, fellBack: false, error: 'NEA adapter not implemented yet' };
}

/** Speed-weighted vector mean of station winds. */
export function summariseWind(stations: NeaStationWind[]): WindSummary {
  return { fromDeg: null, meanSpeedKnots: null, consistency: 0, stationCount: stations.length, label: 'No reading' };
}

/** Null when the incident is more than NEA_RANGE_KM from Singapore. */
export function assessDrift(incident: Incident, ctx: NeaContext): DriftAssessment | null {
  void incident;
  void ctx;
  return null;
}
