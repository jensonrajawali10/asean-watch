import { describe, expect, it } from 'vitest';
import type { Observation } from '../types';
import {
  REASONS,
  REVIEW_LABELS,
  RULE_SUMMARY,
  deriveReview,
  parseUtcTimestamp,
  validateObservations,
  visibleObservations,
} from './reviewRules';

const WINDOW = { start: '2026-10-01T00:00:00Z', end: '2026-10-03T00:00:00Z' };
const KNOWN = new Set(['inc-a', 'inc-b']);

/** Synthetic, valid observation; override any field. */
function obs(id: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id,
    incidentId: 'inc-a',
    observedAt: '2026-10-01T06:00:00Z',
    ingestedAt: '2026-10-01T06:30:00Z',
    category: 'thermal',
    value: 1.5,
    unit: 'MW',
    sourceName: `Test source for ${id}`,
    sourceUrl: `https://example.org/${id}`,
    dataMode: 'simulated',
    qualityNote: 'Synthetic test record.',
    summary: 'Synthetic test record.',
    anomaly: false,
    anomalyReason: null,
    replayStep: 0,
    ...overrides,
  };
}

function anomaly(id: string, category: Observation['category'], observedAt: string, extra: Partial<Observation> = {}) {
  return obs(id, { category, observedAt, anomaly: true, anomalyReason: 'Configured for test', ...extra });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('deriveReview state transitions', () => {
  it('is Monitoring when no record is anomalous', () => {
    const r = deriveReview([obs('a'), obs('b', { category: 'gas', value: 0.4, unit: 'DU' })], WINDOW);
    expect(r.state).toBe('monitoring');
    expect(r.label).toBe('Monitoring');
    expect(r.anomalyCategories).toEqual([]);
    expect(r.evidence.every((e) => !e.counted && e.reason === REASONS.baseline)).toBe(true);
    expect(r.evidence[0].reason).toBe('Within configured baseline; not an anomaly');
  });

  it('is Check observation with one anomaly category', () => {
    const r = deriveReview([obs('base'), anomaly('t1', 'thermal', '2026-10-01T18:00:00Z')], WINDOW);
    expect(r.state).toBe('check');
    expect(r.label).toBe(REVIEW_LABELS.check);
    expect(r.anomalyCategories).toEqual(['thermal']);
    expect(r.evidence.find((e) => e.observation.id === 't1')?.counted).toBe(true);
  });

  it('is Review needed with two distinct categories, in first-seen order regardless of input order', () => {
    const gas = anomaly('g1', 'gas', '2026-10-02T06:00:00Z', { value: 6.2, unit: 'DU' });
    const thermal = anomaly('t1', 'thermal', '2026-10-01T18:00:00Z');
    const r = deriveReview([gas, thermal], WINDOW);
    expect(r.state).toBe('review');
    expect(r.label).toBe('Review needed');
    expect(r.anomalyCategories).toEqual(['thermal', 'gas']);
    expect(r.evidence.map((e) => e.observation.id)).toEqual(['t1', 'g1']);
    expect(r.evidence.every((e) => e.counted)).toBe(true);
  });

  it('two thermal anomalies stay Check observation; only the earliest is counted', () => {
    const later = anomaly('t-later', 'thermal', '2026-10-02T03:00:00Z');
    const earlier = anomaly('t-earlier', 'thermal', '2026-10-01T18:00:00Z');
    const r = deriveReview([later, earlier], WINDOW);
    expect(r.state).toBe('check');
    expect(r.anomalyCategories).toEqual(['thermal']);
    const [first, second] = r.evidence;
    expect(first.observation.id).toBe('t-earlier');
    expect(first.counted).toBe(true);
    expect(second.observation.id).toBe('t-later');
    expect(second.counted).toBe(false);
    expect(second.reason).toBe('Same category as an earlier anomaly; not independent corroboration');
  });

  it('anomaly outside the window is shown but not counted', () => {
    const outside = anomaly('t-old', 'thermal', '2026-09-20T00:00:00Z');
    const r = deriveReview([outside, obs('base')], WINDOW);
    expect(r.state).toBe('monitoring');
    expect(r.anomalyCategories).toEqual([]);
    const item = r.evidence.find((e) => e.observation.id === 't-old');
    expect(item?.counted).toBe(false);
    expect(item?.reason).toBe('Outside scenario window, not counted');
    expect(r.observationCount).toBe(2);
  });

  it('window boundaries are inclusive at both ends (start <= observedAt <= end)', () => {
    const atStart = anomaly('t-start', 'thermal', WINDOW.start);
    const atEnd = anomaly('g-end', 'gas', WINDOW.end);
    const r = deriveReview([atStart, atEnd], WINDOW);
    expect(r.state).toBe('review');
    expect(r.evidence.every((e) => e.counted)).toBe(true);

    const justBefore = anomaly('t-before', 'thermal', '2026-09-30T23:59:59Z');
    const justAfter = anomaly('g-after', 'gas', '2026-10-03T00:00:01Z');
    const r2 = deriveReview([justBefore, justAfter], WINDOW);
    expect(r2.state).toBe('monitoring');
    expect(r2.evidence.every((e) => e.reason === REASONS.outsideWindow)).toBe(true);
  });

  it('an invalid window means no window restriction, and the explanation says so', () => {
    const old = anomaly('t-old', 'thermal', '2020-01-01T00:00:00Z');
    for (const bad of [
      { start: 'not a date', end: WINDOW.end },
      { start: WINDOW.end, end: WINDOW.start }, // start after end
    ]) {
      const r = deriveReview([old], bad);
      expect(r.state).toBe('check');
      expect(r.evidence[0].counted).toBe(true);
      expect(r.explanation.some((l) => /window is invalid/.test(l) && /no window restriction/.test(l))).toBe(true);
    }
  });

  it('explanation states the rule and names each counted record id and source', () => {
    const t = anomaly('t1', 'thermal', '2026-10-01T18:00:00Z');
    const g = anomaly('g1', 'gas', '2026-10-02T06:00:00Z', { value: 6.2, unit: 'DU' });
    const r = deriveReview([t, g, obs('base')], WINDOW);
    expect(r.explanation[0]).toBe(RULE_SUMMARY);
    for (const o of [t, g]) {
      const line = r.explanation.find((l) => l.includes(`"${o.id}"`) && l.startsWith(`Counted ${o.category}`));
      expect(line).toBeDefined();
      expect(line).toContain(o.sourceName);
    }
  });

  it('reports observationCount and latestObservedAt; empty input is Monitoring with null latest', () => {
    const r = deriveReview(
      [obs('x', { observedAt: '2026-10-02T01:00:00Z' }), obs('y', { observedAt: '2026-10-01T01:00:00Z' })],
      WINDOW,
    );
    expect(r.observationCount).toBe(2);
    expect(r.latestObservedAt).toBe('2026-10-02T01:00:00Z');

    const empty = deriveReview([], WINDOW);
    expect(empty.state).toBe('monitoring');
    expect(empty.evidence).toEqual([]);
    expect(empty.observationCount).toBe(0);
    expect(empty.latestObservedAt).toBeNull();
    expect(empty.explanation.some((l) => l.includes('No observations'))).toBe(true);
  });

  it('is deterministic: same input gives deeply equal output', () => {
    const input = [anomaly('t1', 'thermal', '2026-10-01T18:00:00Z'), obs('base')];
    expect(deriveReview(input, WINDOW)).toEqual(deriveReview([...input].reverse(), WINDOW));
  });
});

describe('duplicate ids', () => {
  it('validation keeps the first record, counts and reports the duplicate, and review shows one evidence item', () => {
    const first = anomaly('dup', 'thermal', '2026-10-01T18:00:00Z', { value: 24.6 });
    const second = anomaly('dup', 'thermal', '2026-10-01T19:00:00Z', { value: 99 });
    const v = validateObservations([first, second], KNOWN);
    expect(v.valid).toHaveLength(1);
    expect(v.valid[0].value).toBe(24.6);
    expect(v.duplicatesIgnored).toBe(1);
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0]).toMatchObject({ recordId: 'dup', index: 1 });
    expect(v.issues[0].message).toMatch(/Record "dup" ignored: duplicate id/);

    const r = deriveReview(visibleObservations(v.valid, 'inc-a', 0), WINDOW);
    expect(r.evidence).toHaveLength(1);
    expect(r.state).toBe('check');
  });

  it('deriveReview also ignores repeated ids passed to it directly', () => {
    const a = anomaly('same', 'thermal', '2026-10-01T18:00:00Z');
    const r = deriveReview([a, { ...a }], WINDOW);
    expect(r.evidence).toHaveLength(1);
    expect(r.observationCount).toBe(1);
  });
});

describe('visibleObservations', () => {
  const all = [
    obs('a-step2', { replayStep: 2, observedAt: '2026-10-02T06:00:00Z' }),
    obs('b-other', { incidentId: 'inc-b', observedAt: '2026-10-01T00:00:00Z' }),
    obs('a-z', { observedAt: '2026-10-01T06:00:00Z' }),
    obs('a-step1', { replayStep: 1, observedAt: '2026-10-01T18:00:00Z' }),
    obs('a-a', { observedAt: '2026-10-01T06:00:00Z' }),
  ];

  it('filters by incident and replay step and sorts by observedAt then id', () => {
    expect(visibleObservations(all, 'inc-a', 0).map((o) => o.id)).toEqual(['a-a', 'a-z']);
    expect(visibleObservations(all, 'inc-a', 1).map((o) => o.id)).toEqual(['a-a', 'a-z', 'a-step1']);
    expect(visibleObservations(all, 'inc-a', 2).map((o) => o.id)).toEqual(['a-a', 'a-z', 'a-step1', 'a-step2']);
  });

  it("never leaks another incident's records", () => {
    for (const step of [0, 1, 2, 99]) {
      expect(visibleObservations(all, 'inc-a', step).some((o) => o.incidentId !== 'inc-a')).toBe(false);
      expect(visibleObservations(all, 'inc-b', step).map((o) => o.id)).toEqual(['b-other']);
    }
    expect(visibleObservations(all, 'inc-unknown', 99)).toEqual([]);
  });
});

describe('validateObservations', () => {
  it('accepts valid numeric and qualitative records and returns copies', () => {
    const numeric = obs('n1');
    const text = obs('r1', { category: 'report', value: 'Light ash fall reported', unit: null });
    const v = validateObservations([numeric, text], KNOWN);
    expect(v.issues).toEqual([]);
    expect(v.duplicatesIgnored).toBe(0);
    expect(v.valid).toEqual([numeric, text]);
    expect(v.valid[0]).not.toBe(numeric);
  });

  it('drops extra fields and accepts any incident when no known set is given', () => {
    const raw = { ...obs('x', { incidentId: 'inc-anything' }), extra: 'ignored' };
    const v = validateObservations([raw]);
    expect(v.issues).toEqual([]);
    expect(Object.keys(v.valid[0])).not.toContain('extra');
  });

  it('matches the readable message format for an invalid date', () => {
    const v = validateObservations([obs('obs-x', { observedAt: '2026-13-01' })], KNOWN);
    expect(v.valid).toEqual([]);
    expect(v.issues).toEqual([
      {
        recordId: 'obs-x',
        index: 0,
        message: 'Record "obs-x" skipped: observedAt "2026-13-01" is not a valid ISO 8601 UTC timestamp.',
      },
    ]);
  });

  const invalidCases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['missing id', { id: undefined }, /^Record at position 1 skipped: id is missing\.$/],
    ['non-string id', { id: 42 }, /^Record at position 1 skipped: id must be text, but got 42\.$/],
    ['empty id', { id: '  ' }, /id is empty/],
    ['unknown incident', { incidentId: 'inc-nope' }, /incidentId "inc-nope" does not match any known incident/],
    ['unknown category', { category: 'seismic' }, /category "seismic" is not one of: thermal, gas, deformation, ash, report/],
    ['unknown data mode', { dataMode: 'synthetic' }, /dataMode "synthetic" is not one of: simulated, historical, live/],
    ['unparseable observedAt', { observedAt: 'yesterday' }, /observedAt "yesterday" is not a valid ISO 8601 UTC timestamp/],
    ['impossible date', { observedAt: '2026-02-30T00:00:00Z' }, /observedAt "2026-02-30T00:00:00Z" is not a valid ISO 8601 UTC timestamp/],
    ['offset timestamp', { observedAt: '2026-10-01T13:00:00+07:00' }, /observedAt "2026-10-01T13:00:00\+07:00" is not in UTC; it must end in "Z"/],
    ['timestamp without zone', { ingestedAt: '2026-10-01T06:00:00' }, /ingestedAt "2026-10-01T06:00:00" is not in UTC/],
    ['missing ingestedAt', { ingestedAt: undefined }, /ingestedAt is missing/],
    ['NaN value', { value: Number.NaN }, /value NaN is not a finite number/],
    ['infinite value', { value: Number.POSITIVE_INFINITY }, /value Infinity is not a finite number/],
    ['numeric value without unit', { unit: null }, /numeric value 1\.5 has no unit/],
    ['numeric value with empty unit', { unit: '' }, /numeric value 1\.5 has no unit/],
    ['non-integer replayStep', { replayStep: 1.5 }, /replayStep must be a whole number of 0 or more, but got 1\.5/],
    ['negative replayStep', { replayStep: -1 }, /replayStep must be a whole number of 0 or more, but got -1/],
    ['string replayStep', { replayStep: '1' }, /replayStep must be a whole number of 0 or more, but got "1"/],
    ['non-http sourceUrl', { sourceUrl: 'javascript:alert(1)' }, /sourceUrl "javascript:alert\(1\)" must start with http/],
    ['non-boolean anomaly', { anomaly: 'yes' }, /anomaly must be true or false, but got "yes"/],
  ];

  it.each(invalidCases)('drops a record with %s and explains why', (_name, overrides, pattern) => {
    const record = { ...obs('obs-bad'), ...overrides };
    const v = validateObservations([obs('obs-ok'), record], KNOWN);
    expect(v.valid.map((o) => o.id)).toEqual(['obs-ok']);
    expect(v.issues).toHaveLength(1);
    const [issue] = v.issues;
    expect(issue.index).toBe(1);
    expect(issue.message).toMatch(pattern);
    expect(issue.message).toMatch(/^Record ("obs-bad"|at position 1) skipped: .+\.$/);
    expect(issue.message).not.toMatch(/undefined|\[object Object\]/);
  });

  it('lists every problem of one record in a single issue', () => {
    const v = validateObservations([{ ...obs('multi'), category: 'seismic', value: Number.NaN }], KNOWN);
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0].message).toMatch(/category "seismic".*; value NaN is not a finite number\.$/);
  });

  it('reports non-object entries by position', () => {
    const v = validateObservations([null, 'text', [1, 2]], KNOWN);
    expect(v.valid).toEqual([]);
    expect(v.issues.map((i) => i.message)).toEqual([
      'Record at position 0 skipped: expected a record object, but got null.',
      'Record at position 1 skipped: expected a record object, but got "text".',
      'Record at position 2 skipped: expected a record object, but got a list.',
    ]);
  });

  it.each([[null], [undefined], [{ observations: [] }], ['[]'], [42]])(
    'non-array input %j yields zero records and exactly one readable issue',
    (raw) => {
      const v = validateObservations(raw, KNOWN);
      expect(v.valid).toEqual([]);
      expect(v.duplicatesIgnored).toBe(0);
      expect(v.issues).toHaveLength(1);
      expect(v.issues[0].recordId).toBeNull();
      expect(v.issues[0].message).toMatch(/^Observation data skipped: expected a list of records, but got .+\. No records were loaded\.$/);
    },
  );
});

describe('inputs are never mutated', () => {
  it('validateObservations, visibleObservations, and deriveReview leave frozen inputs untouched', () => {
    const raw = [
      anomaly('t2', 'thermal', '2026-10-02T03:00:00Z'),
      anomaly('t1', 'thermal', '2026-10-01T18:00:00Z'),
      obs('bad', { observedAt: 'nope' }),
      anomaly('g1', 'gas', '2026-10-02T06:00:00Z', { value: 6, unit: 'DU' }),
      anomaly('t1', 'thermal', '2026-10-01T18:00:00Z'),
    ];
    const snapshot = structuredClone(raw);
    deepFreeze(raw);

    const v = validateObservations(raw, KNOWN);
    const visible = visibleObservations(v.valid, 'inc-a', 0);
    const frozenVisible = deepFreeze([...visible].reverse());
    const visibleSnapshot = structuredClone(frozenVisible);
    const r = deriveReview(frozenVisible, WINDOW);

    expect(raw).toEqual(snapshot);
    expect(frozenVisible).toEqual(visibleSnapshot);
    expect(r.state).toBe('review');
    expect(r.evidence.map((e) => e.observation.id)).toEqual(['t1', 't2', 'g1']);
  });
});

describe('parseUtcTimestamp', () => {
  it('accepts strict UTC forms and rejects everything else', () => {
    expect(parseUtcTimestamp('2026-10-01T06:00:00Z')).toBe(Date.UTC(2026, 9, 1, 6, 0, 0));
    expect(parseUtcTimestamp('2026-10-01T06:00Z')).toBe(Date.UTC(2026, 9, 1, 6, 0, 0));
    expect(parseUtcTimestamp('2026-10-01T06:00:00.250Z')).toBe(Date.UTC(2026, 9, 1, 6, 0, 0, 250));
    expect(parseUtcTimestamp('2028-02-29T00:00:00Z')).not.toBeNull();
    for (const bad of ['2026-02-29T00:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01', '2026-10-01 06:00:00Z', 20261001, null]) {
      expect(parseUtcTimestamp(bad)).toBeNull();
    }
  });
});
