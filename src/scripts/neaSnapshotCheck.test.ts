// Tests for scripts/lib/neaSnapshotCheck.mjs, the guard that stops refresh:nea from replacing a good
// snapshot with one the app cannot use. Checked against the real bundled snapshot and against
// normaliseNea, the function the app runs on it.
import { describe, expect, it } from 'vitest';
import snapshotJson from '../../data/nea-snapshot.json';
import { normaliseNea } from '../lib/nea';
import { neaSnapshotProblems } from '../../scripts/lib/neaSnapshotCheck.mjs';

type Responses = { windDirection: unknown; windSpeed: unknown; psi: unknown; pm25: unknown };
const real = (): Responses => structuredClone(snapshotJson.responses) as Responses;

/** Applies a change to a copy of the real responses. */
function withChange(change: (r: Record<string, any>) => void): Responses {
  const r = real() as unknown as Record<string, any>;
  change(r);
  return r as unknown as Responses;
}

const appCanUseWind = (r: Responses): boolean => {
  try {
    normaliseNea(r, 'historical', '2026-10-13T06:49:00Z');
    return true;
  } catch {
    return false;
  }
};

describe('neaSnapshotProblems', () => {
  it('accepts the real bundled snapshot', () => {
    expect(neaSnapshotProblems(real())).toEqual([]);
    expect(appCanUseWind(real())).toBe(true);
  });

  it('rejects a 200 answer with empty readings or items (the case that broke the offline fallback)', () => {
    const cases: Array<[string, Responses, RegExp]> = [
      ['empty wind-direction readings', withChange((r) => (r.windDirection.data.readings = [])), /^windDirection: empty readings$/],
      ['empty wind-direction data', withChange((r) => (r.windDirection.data.readings[0].data = [])), /^windDirection: empty readings$/],
      ['no wind-direction stations', withChange((r) => (r.windDirection.data.stations = [])), /^windDirection: no stations/],
      ['empty wind-speed readings', withChange((r) => (r.windSpeed.data.readings = [])), /^windSpeed: empty readings$/],
      ['empty PSI items', withChange((r) => (r.psi.data.items = [])), /^psi: empty items$/],
      ['PSI without 24-hour values', withChange((r) => (r.psi.data.items[0].readings.psi_twenty_four_hourly = {})), /^psi: no psi_twenty_four_hourly/],
      ['empty PM2.5 items', withChange((r) => (r.pm25.data.items = [])), /^pm25: empty items$/],
      ['no data block', withChange((r) => (r.windDirection = { code: 0, data: null })), /^windDirection: no data block$/],
    ];
    for (const [label, responses, problem] of cases) {
      const problems = neaSnapshotProblems(responses);
      expect(problems, label).toHaveLength(1);
      expect(problems[0], label).toMatch(problem);
    }
  });

  it('rejects wind readings the app would drop: out-of-range, non-numeric or for unknown stations', () => {
    const outOfRange = withChange((r) => {
      for (const d of r.windDirection.data.readings[0].data) d.value = 400;
    });
    const textValues = withChange((r) => {
      for (const d of r.windDirection.data.readings[0].data) d.value = String(d.value);
    });
    const unknownStations = withChange((r) => {
      for (const d of r.windDirection.data.readings[0].data) d.stationId = `X${d.stationId}`;
    });
    for (const r of [outOfRange, textValues, unknownStations]) {
      expect(neaSnapshotProblems(r)).toEqual(['windDirection: no usable station value']);
      // The app agrees: normaliseNea cannot build a wind layer from these.
      expect(appCanUseWind(r)).toBe(false);
    }
  });

  it('never accepts wind that normaliseNea would reject', () => {
    const variants: Responses[] = [
      withChange((r) => (r.windDirection.data.readings = [])),
      withChange((r) => {
        r.windDirection.data.stations = [];
        r.windSpeed.data.stations = [];
      }),
      withChange((r) => (r.windDirection = null)),
      withChange((r) => (r.windDirection = { code: 0, data: { stations: [], readings: [{ timestamp: 'x', data: [] }] } })),
    ];
    for (const r of variants) {
      expect(appCanUseWind(r)).toBe(false);
      expect(neaSnapshotProblems(r).some((p) => p.startsWith('windDirection'))).toBe(true);
    }
  });

  it('lists every problem at once', () => {
    expect(neaSnapshotProblems({})).toEqual([
      'windDirection: no data block',
      'windSpeed: no data block',
      'psi: empty items',
      'pm25: empty items',
    ]);
  });
});
