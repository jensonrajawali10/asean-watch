// Review rules and record validation for ASEAN Watch. Owned by the logic builder.
// Everything here is pure and deterministic: no wall-clock time, no I/O, inputs are never mutated.
import { CATEGORIES, DATA_MODES } from '../types';
import type {
  Category,
  DataMode,
  EvidenceItem,
  Observation,
  ReviewLabel,
  ReviewResult,
  ReviewState,
  ValidationIssue,
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

/** First line of every `ReviewResult.explanation`. */
export const RULE_SUMMARY =
  'Rule: 0 distinct anomaly categories = Monitoring; 1 = Check observation; 2 or more = Review ' +
  'needed. Repeat anomalies from one category are not independent corroboration. Illustrative ' +
  'workflow rule, not a scientific threshold or an official alert level.';

/** Exact per-record reasons from docs/CONTRACT.md "Review rules". */
export const REASONS = {
  outsideWindow: 'Outside scenario window, not counted',
  sameCategory: 'Same category as an earlier anomaly; not independent corroboration',
  baseline: 'Within configured baseline; not an anomaly',
} as const;

/** Reason for a record that adds a new distinct anomaly category (the contract leaves this wording open). */
export function countedReason(category: Category, windowApplied = true): string {
  return windowApplied
    ? `First ${category} anomaly inside the scenario window; counted as a distinct category`
    : `First ${category} anomaly; counted as a distinct category`;
}

// ---------------------------------------------------------------------------
// Timestamps

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?Z$/;
/** Looks like ISO 8601 but carries an offset or no zone at all, i.e. not UTC. */
const ISO_NOT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a strict ISO 8601 UTC timestamp ("2026-10-01T06:00:00Z", seconds and fraction optional)
 * to epoch milliseconds. Returns null for anything else, including impossible dates.
 */
export function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = ISO_UTC.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Math.floor(Number(`0.${m[7]}`) * 1000);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millis);
  // Reject overflowed dates such as 2026-02-30 (which Date would roll into March).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d.getTime();
}

function timeValue(iso: string): number {
  const t = parseUtcTimestamp(iso);
  return t === null ? Number.POSITIVE_INFINITY : t;
}

/** Sort order used everywhere: observedAt ascending, then id. Unparseable times sort last. */
export function compareObservations(a: Observation, b: Observation): number {
  const ta = timeValue(a.observedAt);
  const tb = timeValue(b.observedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Validation

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short, readable rendering of a raw value for messages. */
function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const s = value.length > 60 ? `${value.slice(0, 57)}...` : value;
    return JSON.stringify(s);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function checkText(record: RawRecord, field: string, problems: string[], allowEmpty = false): void {
  const v = record[field];
  if (isMissing(v)) problems.push(`${field} is missing`);
  else if (typeof v !== 'string') problems.push(`${field} must be text, but got ${show(v)}`);
  else if (!allowEmpty && v.trim() === '') problems.push(`${field} is empty`);
}

function checkTimestamp(record: RawRecord, field: string, problems: string[]): void {
  const v = record[field];
  if (isMissing(v)) {
    problems.push(`${field} is missing`);
  } else if (typeof v !== 'string') {
    problems.push(`${field} must be an ISO 8601 UTC timestamp such as "2026-10-01T06:00:00Z", but got ${show(v)}`);
  } else if (parseUtcTimestamp(v) === null) {
    problems.push(
      ISO_NOT_UTC.test(v)
        ? `${field} ${show(v)} is not in UTC; it must end in "Z", for example "2026-10-01T06:00:00Z"`
        : `${field} ${show(v)} is not a valid ISO 8601 UTC timestamp`,
    );
  }
}

function checkOneOf(record: RawRecord, field: string, allowed: readonly string[], problems: string[]): void {
  const v = record[field];
  if (isMissing(v)) problems.push(`${field} is missing`);
  else if (typeof v !== 'string' || !allowed.includes(v)) {
    problems.push(`${field} ${show(v)} is not one of: ${allowed.join(', ')}`);
  }
}

function recordProblems(record: RawRecord, knownIncidentIds?: ReadonlySet<string>): string[] {
  const problems: string[] = [];

  checkText(record, 'id', problems);

  checkText(record, 'incidentId', problems);
  const incidentId = record.incidentId;
  if (knownIncidentIds && typeof incidentId === 'string' && incidentId.trim() !== '' && !knownIncidentIds.has(incidentId)) {
    problems.push(`incidentId ${show(incidentId)} does not match any known incident`);
  }

  checkOneOf(record, 'category', CATEGORIES, problems);
  checkOneOf(record, 'dataMode', DATA_MODES, problems);
  checkTimestamp(record, 'observedAt', problems);
  checkTimestamp(record, 'ingestedAt', problems);

  const value = record.value;
  const unit = record.unit;
  if (isMissing(value)) {
    problems.push('value is missing');
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(`value ${show(value)} is not a finite number`);
    else if (typeof unit !== 'string' || unit.trim() === '') {
      problems.push(`numeric value ${show(value)} has no unit`);
    }
  } else if (typeof value === 'string') {
    if (value.trim() === '') problems.push('value is empty');
    if (unit !== undefined && unit !== null && typeof unit !== 'string') {
      problems.push(`unit must be text or null, but got ${show(unit)}`);
    }
  } else {
    problems.push(`value must be a number or text, but got ${show(value)}`);
  }

  const step = record.replayStep;
  if (isMissing(step)) problems.push('replayStep is missing');
  else if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) {
    problems.push(`replayStep must be a whole number of 0 or more, but got ${show(step)}`);
  }

  checkText(record, 'sourceName', problems);
  checkText(record, 'sourceUrl', problems);
  const url = record.sourceUrl;
  if (typeof url === 'string' && url.trim() !== '' && !/^https?:\/\//i.test(url.trim())) {
    problems.push(`sourceUrl ${show(url)} must start with http:// or https://`);
  }
  checkText(record, 'qualityNote', problems, true);
  checkText(record, 'summary', problems, true);

  if (typeof record.anomaly !== 'boolean') {
    problems.push(`anomaly must be true or false, but got ${show(record.anomaly)}`);
  }
  const reason = record.anomalyReason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    problems.push(`anomalyReason must be text or null, but got ${show(reason)}`);
  }

  return problems;
}

/** Copy only the contract fields into a fresh object (never returns the input object). */
function toObservation(r: RawRecord): Observation {
  return {
    id: r.id as string,
    incidentId: r.incidentId as string,
    observedAt: r.observedAt as string,
    ingestedAt: r.ingestedAt as string,
    category: r.category as Category,
    value: r.value as number | string,
    unit: typeof r.unit === 'string' ? r.unit : null,
    sourceName: r.sourceName as string,
    sourceUrl: (r.sourceUrl as string).trim(),
    dataMode: r.dataMode as DataMode,
    qualityNote: r.qualityNote as string,
    summary: r.summary as string,
    anomaly: r.anomaly as boolean,
    anomalyReason: typeof r.anomalyReason === 'string' ? r.anomalyReason : null,
    replayStep: r.replayStep as number,
  };
}

/** Validate raw fixture records. Drops duplicate ids (first wins) and invalid records with readable issues. */
export function validateObservations(
  raw: unknown,
  knownIncidentIds?: ReadonlySet<string>,
): ValidationResult {
  if (!Array.isArray(raw)) {
    return {
      valid: [],
      issues: [
        {
          recordId: null,
          index: -1,
          message: `Observation data skipped: expected a list of records, but got ${show(raw)}. No records were loaded.`,
        },
      ],
      duplicatesIgnored: 0,
    };
  }

  const valid: Observation[] = [];
  const issues: ValidationIssue[] = [];
  const firstIndexById = new Map<string, number>();
  let duplicatesIgnored = 0;

  raw.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) {
      issues.push({
        recordId: null,
        index,
        message: `Record at position ${index} skipped: expected a record object, but got ${show(item)}.`,
      });
      return;
    }
    const readableId = typeof item.id === 'string' && item.id.trim() !== '' ? item.id : null;
    const label = readableId === null ? `Record at position ${index}` : `Record ${show(readableId)}`;

    const problems = recordProblems(item, knownIncidentIds);
    if (problems.length > 0) {
      issues.push({ recordId: readableId, index, message: `${label} skipped: ${problems.join('; ')}.` });
      return;
    }

    const id = item.id as string;
    const firstIndex = firstIndexById.get(id);
    if (firstIndex !== undefined) {
      duplicatesIgnored += 1;
      issues.push({
        recordId: id,
        index,
        message: `${label} ignored: duplicate id; the first record with this id (position ${firstIndex}) is kept.`,
      });
      return;
    }
    firstIndexById.set(id, index);
    valid.push(toObservation(item));
  });

  return { valid, issues, duplicatesIgnored };
}

// ---------------------------------------------------------------------------
// Visibility and review

/** Records for one incident with replayStep <= replayIndex, sorted by observedAt then id. */
export function visibleObservations(
  all: Observation[],
  incidentId: string,
  replayIndex: number,
): Observation[] {
  // filter() returns a new array, so sorting it never reorders the caller's array.
  return all
    .filter((o) => o.incidentId === incidentId && o.replayStep <= replayIndex)
    .sort(compareObservations);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function quoteIds(items: Observation[]): string {
  return items.map((o) => `"${o.id}"`).join(', ');
}

/** Derive review state and evidence reasons from visible observations. Pure and deterministic. */
export function deriveReview(
  observations: Observation[],
  window: { start: string; end: string },
): ReviewResult {
  // Defensive de-duplication (validation already does this): first occurrence of an id wins.
  const seen = new Set<string>();
  const unique: Observation[] = [];
  let duplicates = 0;
  for (const o of observations) {
    if (seen.has(o.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(o.id);
    unique.push(o);
  }
  const sorted = unique.sort(compareObservations); // `unique` is our own array

  const start = parseUtcTimestamp(window?.start);
  const end = parseUtcTimestamp(window?.end);
  const windowApplied = start !== null && end !== null && start <= end;

  const evidence: EvidenceItem[] = [];
  const anomalyCategories: Category[] = [];
  const countedRecords: Observation[] = [];
  const repeats: Observation[] = [];
  const outside: Observation[] = [];
  let baselineCount = 0;

  for (const o of sorted) {
    const t = parseUtcTimestamp(o.observedAt);
    const inWindow = !windowApplied || (t !== null && t >= (start as number) && t <= (end as number));
    if (!inWindow) {
      evidence.push({ observation: o, counted: false, reason: REASONS.outsideWindow });
      outside.push(o);
    } else if (!o.anomaly) {
      evidence.push({ observation: o, counted: false, reason: REASONS.baseline });
      baselineCount += 1;
    } else if (anomalyCategories.includes(o.category)) {
      evidence.push({ observation: o, counted: false, reason: REASONS.sameCategory });
      repeats.push(o);
    } else {
      anomalyCategories.push(o.category);
      countedRecords.push(o);
      evidence.push({ observation: o, counted: true, reason: countedReason(o.category, windowApplied) });
    }
  }

  const state: ReviewState =
    anomalyCategories.length === 0 ? 'monitoring' : anomalyCategories.length === 1 ? 'check' : 'review';
  const label = REVIEW_LABELS[state];

  const explanation: string[] = [RULE_SUMMARY];
  if (windowApplied) {
    explanation.push(
      `Scenario window: ${window.start} to ${window.end}. Records observed outside it are shown but not counted.`,
    );
  } else {
    explanation.push(
      `Scenario window is invalid (start ${show(window?.start)}, end ${show(window?.end)}), so no ` +
        'window restriction was applied: every visible record was considered.',
    );
  }
  if (sorted.length === 0) {
    explanation.push('No observations are visible at this replay step.');
  }
  explanation.push(
    `Result: ${label}. ${plural(anomalyCategories.length, 'distinct anomaly category', 'distinct anomaly categories')}` +
      `${anomalyCategories.length > 0 ? ` (${anomalyCategories.join(', ')})` : ''} from ` +
      `${plural(sorted.length, 'visible record', 'visible records')}.`,
  );
  for (const o of countedRecords) {
    explanation.push(`Counted ${o.category}: record "${o.id}" observed ${o.observedAt}, source: ${o.sourceName}.`);
  }
  for (const o of repeats) {
    const first = countedRecords.find((c) => c.category === o.category);
    explanation.push(
      `Not counted: record "${o.id}" repeats the ${o.category} category of record "${first?.id ?? '?'}"; ` +
        'not independent corroboration.',
    );
  }
  if (baselineCount > 0) {
    explanation.push(
      `${plural(baselineCount, 'record is', 'records are')} within the configured baseline (not anomalies).`,
    );
  }
  if (outside.length > 0) {
    explanation.push(`Outside scenario window, not counted: ${quoteIds(outside)}.`);
  }
  if (duplicates > 0) {
    explanation.push(
      `${plural(duplicates, 'record with a repeated id was', 'records with repeated ids were')} ignored; ` +
        'the first record with each id is kept.',
    );
  }

  let latestObservedAt: string | null = null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const o of sorted) {
    const t = parseUtcTimestamp(o.observedAt);
    if (t !== null && t > latest) {
      latest = t;
      latestObservedAt = o.observedAt;
    }
  }
  if (latestObservedAt === null && sorted.length > 0) latestObservedAt = sorted[sorted.length - 1].observedAt;

  return {
    state,
    label,
    anomalyCategories,
    evidence,
    explanation,
    observationCount: sorted.length,
    latestObservedAt,
  };
}
