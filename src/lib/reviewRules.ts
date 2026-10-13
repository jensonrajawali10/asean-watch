// STUB: owned by the logic agent. Signatures are the contract; bodies get replaced.
import type {
  Observation,
  ReviewLabel,
  ReviewResult,
  ReviewState,
  ValidationResult,
} from '../types';

export const REVIEW_LABELS: Record<ReviewState, ReviewLabel> = {
  monitoring: 'Monitoring',
  check: 'Check observation',
  review: 'Review needed',
};

/** Plain-language rule shown in the detail view. */
export const RULE_TEXT =
  'Monitoring: no record is marked anomalous. Check observation: at least one anomaly. ' +
  'Review needed: anomalies from at least two distinct categories inside the scenario window. ' +
  'Repeat readings from one category do not count as independent corroboration. ' +
  'These are illustrative workflow rules, not scientific thresholds or official alert levels.';

/** Validate raw fixture records. Drops duplicate ids (first wins) and invalid records with readable issues. */
export function validateObservations(
  raw: unknown,
  knownIncidentIds?: ReadonlySet<string>,
): ValidationResult {
  void knownIncidentIds;
  return { valid: Array.isArray(raw) ? (raw as Observation[]) : [], issues: [], duplicatesIgnored: 0 };
}

/** Records for one incident with replayStep <= replayIndex, sorted by observedAt then id. */
export function visibleObservations(
  all: Observation[],
  incidentId: string,
  replayIndex: number,
): Observation[] {
  return all.filter((o) => o.incidentId === incidentId && o.replayStep <= replayIndex);
}

/** Derive review state and evidence reasons from visible observations. Pure and deterministic. */
export function deriveReview(
  observations: Observation[],
  window: { start: string; end: string },
): ReviewResult {
  void window;
  return {
    state: 'monitoring',
    label: 'Monitoring',
    anomalyCategories: [],
    evidence: observations.map((o) => ({ observation: o, counted: false, reason: 'stub' })),
    explanation: [],
    observationCount: observations.length,
    latestObservedAt: null,
  };
}
