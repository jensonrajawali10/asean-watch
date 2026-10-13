// Runs the review pipeline against the REAL fixtures in data/ (no mocks).
import { describe, expect, it } from 'vitest';
import type { Incident } from '../types';
import { buildBriefing } from './briefing';
import { findVolcano, loadFixtures, normalizeScenario, replayStepsFor } from './fixtures';
import { REASONS, deriveReview, visibleObservations } from './reviewRules';

const MERAPI_ID = 'inc-merapi-demo';
const fx = loadFixtures();

function incident(id: string): Incident {
  const found = fx.incidents.find((i) => i.id === id);
  if (!found) throw new Error(`Incident "${id}" is missing from data/incidents.json`);
  return found;
}

function only(hazard: Incident['hazard']): Incident {
  const matches = fx.incidents.filter((i) => i.hazard === hazard && i.id !== MERAPI_ID);
  expect(matches, `expected exactly one secondary ${hazard} example`).toHaveLength(1);
  return matches[0];
}

function reviewAt(inc: Incident, replayIndex: number) {
  return deriveReview(visibleObservations(fx.observations, inc.id, replayIndex), inc.scenarioWindow);
}

describe('real fixtures load cleanly', () => {
  it('have zero validation issues and no duplicates', () => {
    expect(fx.issues.map((i) => i.message)).toEqual([]);
    expect(fx.duplicatesIgnored).toBe(0);
    expect(fx.observations.length).toBeGreaterThan(0);
  });

  it('contain no live records, and every incident is simulated', () => {
    expect(fx.observations.filter((o) => o.dataMode === 'live').map((o) => o.id)).toEqual([]);
    expect(fx.incidents.filter((i) => i.dataMode !== 'simulated').map((i) => i.id)).toEqual([]);
  });

  it('link Merapi to the Smithsonian GVP catalog entry', () => {
    const merapi = incident(MERAPI_ID);
    expect(merapi.replayable).toBe(true);
    expect(merapi.volcanoId).toBe('gvp-263250');
    const volcano = findVolcano(fx.volcanoes, merapi.volcanoId);
    expect(volcano).not.toBeNull();
    expect(volcano).toMatchObject({ gvpNumber: '263250', name: 'Merapi', lat: -7.54, lon: 110.446 });
    expect(volcano?.catalogSource.url).toMatch(/^https:\/\/volcano\.si\.edu\//);
    expect(findVolcano(fx.volcanoes, null)).toBeNull();
    expect(findVolcano(fx.volcanoes, 'gvp-nope')).toBeNull();
  });
});

describe('Merapi replay', () => {
  const merapi = incident(MERAPI_ID);

  it('has steps 0/1/2 labelled Baseline, Thermal observation, Gas observation', () => {
    const steps = replayStepsFor(fx, MERAPI_ID);
    expect(steps.map((s) => [s.index, s.label])).toEqual([
      [0, 'Baseline'],
      [1, 'Thermal observation'],
      [2, 'Gas observation'],
    ]);
  });

  it('step 0 is Monitoring with non-anomalous thermal, gas, and deformation records', () => {
    const r = reviewAt(merapi, 0);
    expect(r.label).toBe('Monitoring');
    expect(r.anomalyCategories).toEqual([]);
    const categories = new Set(r.evidence.map((e) => e.observation.category));
    for (const c of ['thermal', 'gas', 'deformation'] as const) expect(categories.has(c)).toBe(true);
    expect(r.evidence.every((e) => !e.observation.anomaly && e.reason === REASONS.baseline)).toBe(true);
  });

  it('step 1 is Check observation: two thermal anomalies, the second not counted', () => {
    const r = reviewAt(merapi, 1);
    expect(r.label).toBe('Check observation');
    expect(r.anomalyCategories).toEqual(['thermal']);
    const thermalAnomalies = r.evidence.filter((e) => e.observation.anomaly && e.observation.category === 'thermal');
    expect(thermalAnomalies).toHaveLength(2);
    expect(thermalAnomalies[0].counted).toBe(true);
    expect(thermalAnomalies[1].counted).toBe(false);
    expect(thermalAnomalies[1].reason).toBe('Same category as an earlier anomaly; not independent corroboration');
    expect(thermalAnomalies[0].observation.sourceName).not.toBe(thermalAnomalies[1].observation.sourceName);
    const newAtStep1 = fx.observations.filter((o) => o.incidentId === MERAPI_ID && o.replayStep === 1);
    expect(newAtStep1.every((o) => o.category === 'thermal' && o.anomaly)).toBe(true);
  });

  it('step 2 is Review needed: thermal + gas', () => {
    const r = reviewAt(merapi, 2);
    expect(r.label).toBe('Review needed');
    expect(r.anomalyCategories).toEqual(['thermal', 'gas']);
    expect(r.evidence.filter((e) => e.counted)).toHaveLength(2);
    const newAtStep2 = fx.observations.filter((o) => o.incidentId === MERAPI_ID && o.replayStep === 2);
    expect(newAtStep2.map((o) => [o.category, o.anomaly])).toEqual([['gas', true]]);
  });

  it('every Merapi record is inside the scenario window (nothing silently excluded)', () => {
    const r = reviewAt(merapi, 99);
    expect(r.evidence.filter((e) => e.reason === REASONS.outsideWindow).map((e) => e.observation.id)).toEqual([]);
  });

  it('the step 2 brief names every evidence record, its source URL, and the step clock', () => {
    const steps = replayStepsFor(fx, MERAPI_ID);
    const review = reviewAt(merapi, 2);
    const text = buildBriefing({
      incident: merapi,
      volcano: findVolcano(fx.volcanoes, merapi.volcanoId),
      step: steps[2],
      review,
      issues: fx.issues,
    });
    expect(text).toContain(steps[2].clock);
    expect(text.replace(/\s+/g, ' ')).toContain('elevation 2910 m');
    for (const e of review.evidence) {
      expect(text).toContain(e.observation.id);
      expect(text).toContain(e.observation.sourceUrl);
    }
  });
});

describe('secondary examples', () => {
  const wildfire = only('wildfire');

  it('are static, simulated, and keep every record at replay step 0', () => {
    for (const inc of [wildfire]) {
      expect(inc.replayable).toBe(false);
      expect(inc.dataMode).toBe('simulated');
      expect(replayStepsFor(fx, inc.id)).toEqual([]);
      const own = fx.observations.filter((o) => o.incidentId === inc.id);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((o) => o.replayStep === 0 && o.dataMode === 'simulated')).toBe(true);
    }
  });

  it('wildfire example is Check observation (one thermal anomaly)', () => {
    const r = reviewAt(wildfire, 0);
    expect(r.label).toBe('Check observation');
    expect(r.anomalyCategories).toEqual(['thermal']);
  });

  it('has no simulated flood example (flood watch uses official gauges, see warnings.ts)', () => {
    expect(fx.incidents.some((i) => i.hazard === 'flood')).toBe(false);
  });

  it('never include Merapi records at any replay index', () => {
    const merapiIds = new Set(fx.observations.filter((o) => o.incidentId === MERAPI_ID).map((o) => o.id));
    for (const inc of [wildfire]) {
      for (const step of [0, 1, 2, 99]) {
        const visible = visibleObservations(fx.observations, inc.id, step);
        expect(visible.every((o) => o.incidentId === inc.id && !merapiIds.has(o.id))).toBe(true);
      }
    }
  });
});

describe('normalizeScenario', () => {
  it('falls back to a single Baseline step when replaySteps is missing or empty', () => {
    for (const raw of [{ incidentId: MERAPI_ID }, { incidentId: MERAPI_ID, replaySteps: [] }, null]) {
      const s = normalizeScenario(raw, fx.incidents);
      expect(s.incidentId).toBe(MERAPI_ID);
      expect(s.replaySteps).toHaveLength(1);
      expect(s.replaySteps[0]).toMatchObject({ index: 0, label: 'Baseline', clock: incident(MERAPI_ID).scenarioWindow.start });
    }
  });

  it('sorts steps by index and drops malformed ones', () => {
    const s = normalizeScenario(
      {
        incidentId: MERAPI_ID,
        replaySteps: [
          { index: 1, label: 'B', description: 'b', clock: '2026-10-02T00:00:00Z' },
          { index: -1, label: 'bad', clock: 'x' },
          { index: 0, label: 'A', clock: '2026-10-01T00:00:00Z' },
        ],
      },
      fx.incidents,
    );
    expect(s.replaySteps.map((x) => [x.index, x.label, x.description])).toEqual([
      [0, 'A', ''],
      [1, 'B', 'b'],
    ]);
  });
});
