import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident, Observation, ReplayStep, ValidationIssue, Volcano } from '../types';
import { NEXT_STEP, buildBriefing, briefingFilename, replayDayLabel, type BriefingInput } from './briefing';
import { deriveReview } from './reviewRules';

const incident: Incident = {
  id: 'inc-test-volcano',
  title: 'Test volcano observations',
  hazard: 'volcano',
  volcanoId: 'gvp-000001',
  locationName: 'Test Province, Indonesia',
  country: 'Indonesia',
  lat: -7.54,
  lon: 110.446,
  dataMode: 'historical',
  scenarioWindow: { start: '2026-10-01T00:00:00Z', end: '2026-10-03T00:00:00Z' },
  replayable: true,
  summary: 'Synthetic incident for tests.',
};

const volcano: Volcano = {
  id: 'gvp-000001',
  gvpNumber: '000001',
  name: 'Testvolcano',
  country: 'Indonesia',
  region: 'Java',
  lat: -7.54,
  lon: 110.446,
  elevationM: 2910,
  catalogSource: { name: 'Test catalog', url: 'https://example.org/catalog/000001' },
};

const step: ReplayStep = {
  index: 2,
  label: 'Gas observation',
  description: 'A gas anomaly adds a second category.',
  clock: '2026-10-02T10:00:00Z',
};

function obs(id: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id,
    incidentId: incident.id,
    observedAt: '2026-10-01T06:00:00Z',
    ingestedAt: '2026-10-01T06:30:00Z',
    category: 'thermal',
    value: 2.1,
    unit: 'MW',
    sourceName: `NASA FIRMS VIIRS 375 m active fire detections (${id})`,
    sourceUrl: `https://example.org/source/${id}`,
    dataMode: 'historical',
    qualityNote: `Quality note for ${id}.`,
    summary: `Summary for ${id}.`,
    anomaly: false,
    anomalyReason: null,
    replayStep: 0,
    ...overrides,
  };
}

const observations: Observation[] = [
  obs('obs-thermal-base'),
  obs('obs-thermal-a', {
    observedAt: '2026-10-01T18:00:00Z',
    value: 24.6,
    anomaly: true,
    anomalyReason: 'Above the illustrative 10 MW threshold.',
    replayStep: 1,
  }),
  obs('obs-thermal-b', {
    observedAt: '2026-10-02T03:00:00Z',
    value: 31.8,
    anomaly: true,
    anomalyReason: 'Above the illustrative 10 MW threshold.',
    replayStep: 1,
  }),
  obs('obs-gas-a', {
    category: 'gas',
    observedAt: '2026-10-02T06:00:00Z',
    value: 6.2,
    unit: 'DU',
    anomaly: true,
    anomalyReason: 'Above the illustrative 2 DU threshold.',
    replayStep: 2,
  }),
];

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    incident,
    volcano,
    step,
    review: deriveReview(observations, incident.scenarioWindow),
    issues: [],
    ...overrides,
  };
}

/** Collapse whitespace so assertions do not depend on where long lines wrap. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildBriefing', () => {
  it('is deterministic: same input twice, a structural copy, and a different wall clock give identical text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const a = buildBriefing(input());
    vi.setSystemTime(new Date('1999-06-15T12:34:56Z'));
    const b = buildBriefing(input());
    const c = buildBriefing(structuredClone(input()));
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a).not.toContain('2030');
    expect(a).not.toContain('1999');
  });

  it('includes incident, location, coordinates, catalog, replay day, clock, state, and the REAL DATA notice', () => {
    const raw = buildBriefing(input());
    const text = flat(raw);
    const firstLines = raw.split('\n').slice(0, 4).join('\n');
    expect(firstLines).toContain(
      '*** REAL DATA (snapshot as of 2026-10-01T06:30:00Z) - NOT A FORECAST AND NOT AN OFFICIAL WARNING ***',
    );
    expect(text).not.toMatch(/simulated|fictional/i);
    expect(text).toContain(incident.title);
    expect(text).toContain(incident.locationName);
    expect(text).toContain('lat -7.54, lon 110.446');
    expect(text).toContain('Test catalog');
    expect(text).toContain('https://example.org/catalog/000001');
    expect(text).toContain('elevation 2910 m');
    expect(text).toContain('Replay step: Day 3 of 7 (2026-10-02 UTC)');
    expect(text).toContain('Step label: Gas observation');
    expect(text).toContain(step.clock);
    expect(text).toMatch(/State:\s+Review needed/);
    expect(text).toContain('thermal, gas');
  });

  it('lists every evidence record with a numbered reference, sources, times, mode, quality note, and reason', () => {
    const review = deriveReview(observations, incident.scenarioWindow);
    const text = flat(buildBriefing(input({ review })));
    review.evidence.forEach((e, i) => {
      const o = e.observation;
      expect(text).toContain(`[E${i + 1}] ${o.id}`);
      expect(text).toContain(o.sourceUrl);
      expect(text).toContain(o.sourceName);
      expect(text).toContain(o.observedAt);
      expect(text).toContain(o.ingestedAt);
      expect(text).toContain(o.qualityNote);
      expect(text).toContain(e.reason);
    });
    expect(text).toContain('24.6 MW');
    expect(text).toContain('6.2 DU');
    expect(text).toMatch(/Data mode:\s+HISTORICAL/);
    expect(text).toContain('NO - Same category as an earlier anomaly; not independent corroboration');
    expect(text).not.toContain('[E5]');
  });

  it('includes limitations, analyst questions derived from gaps, and the next step', () => {
    const text = flat(buildBriefing(input()));
    expect(text).toContain('LIMITATIONS');
    expect(text).toContain('QUESTIONS FOR AN ANALYST');
    expect(text).toMatch(/No deformation anomaly is present/);
    expect(text).toMatch(/No ground observation or field report is included/);
    expect(text).toMatch(/thermal hotspot\? Its cause is unconfirmed/);
    expect(text).toMatch(/"obs-thermal-b" repeats an earlier anomaly category/);
    expect(text).toContain('SUGGESTED NEXT STEP');
    expect(text).toContain('Consult the relevant volcano observatory and corroborating ground measurements.');
  });

  it('handles zero evidence', () => {
    const text = flat(buildBriefing(input({ review: deriveReview([], incident.scenarioWindow) })));
    expect(text).toContain('No observations at this replay step.');
    expect(text).toMatch(/State:\s+Monitoring/);
    expect(text).toContain('REAL DATA (snapshot, time not given)');
    expect(text).toContain(NEXT_STEP.volcano);
    expect(text).not.toContain('[E1]');
  });

  it('lists validation issues when present and says none otherwise', () => {
    const issues: ValidationIssue[] = [
      { recordId: 'obs-x', index: 3, message: 'Record "obs-x" skipped: observedAt "2026-13-01" is not a valid ISO 8601 UTC timestamp.' },
    ];
    const withIssues = flat(buildBriefing(input({ issues })));
    expect(withIssues).toContain('VALIDATION ISSUES');
    expect(withIssues).toContain('Record "obs-x" skipped');
    expect(withIssues).toContain('(input position 3)');
    expect(flat(buildBriefing(input()))).toContain('None. Every input record passed validation.');
  });

  it('shows "static example" instead of a clock for a non-replayable incident', () => {
    const wildfire: Incident = {
      ...incident,
      id: 'inc-test-fire',
      title: 'Test peatland hotspots',
      hazard: 'wildfire',
      volcanoId: null,
      replayable: false,
    };
    const fireObs = [obs('obs-fire', { incidentId: wildfire.id, anomaly: true, anomalyReason: 'Configured.' })];
    const review = deriveReview(fireObs, wildfire.scenarioWindow);
    const text = flat(buildBriefing({ incident: wildfire, volcano: null, step, review, issues: [] }));
    expect(text).toMatch(/Replay clock:\s+static example/);
    expect(text).not.toContain(step.clock);
    expect(text).toMatch(/State:\s+Check observation/);
    expect(text).toContain('Consult the relevant national agency and corroborating ground reports.');
    expect(text).not.toContain('volcano observatory');
    expect(text).toContain('not applicable');
  });

  it('uses \\n line endings, keeps non-URL lines within 100 characters, and ends with a newline', () => {
    const text = buildBriefing(input());
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    const long = text.split('\n').filter((l) => l.length > 100 && !/https?:\/\//.test(l));
    expect(long).toEqual([]);
  });

  it('never states a probability, an eruption forecast, or an evacuation instruction', () => {
    const text = flat(buildBriefing(input()));
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/will erupt|eruption (is )?(expected|likely|imminent)|evacuate /i);
  });
});

describe('real-data header and replay day', () => {
  const header = (text: string) => text.split('\n')[2];

  it('uses dataAsOf for the snapshot time when given', () => {
    expect(header(buildBriefing(input({ dataAsOf: '2026-10-13T07:22:17Z' })))).toBe(
      '*** REAL DATA (snapshot as of 2026-10-13T07:22:17Z) - NOT A FORECAST AND NOT AN OFFICIAL WARNING ***',
    );
  });

  it('says live when any record is live', () => {
    const live = observations.map((o, i) => (i === 0 ? { ...o, dataMode: 'live' as const } : o));
    const text = buildBriefing(input({ review: deriveReview(live, incident.scenarioWindow), dataAsOf: '2026-10-13T07:22:17Z' }));
    expect(header(text)).toBe('*** REAL DATA (live) - NOT A FORECAST AND NOT AN OFFICIAL WARNING ***');
  });

  it('still flags simulated input loudly if any reaches the brief', () => {
    const sim = observations.map((o) => ({ ...o, dataMode: 'simulated' as const }));
    const text = buildBriefing(input({ review: deriveReview(sim, incident.scenarioWindow) }));
    expect(header(text)).toBe('*** SIMULATED DEMO DATA - NOT A FORECAST AND NOT AN OFFICIAL WARNING ***');
  });

  it('labels replay steps as Day n of 7 with the UTC date', () => {
    expect(replayDayLabel({ index: 0, label: 'x', description: '', clock: '2026-10-07T23:59:59Z' })).toBe(
      'Day 1 of 7 (2026-10-07 UTC)',
    );
    expect(replayDayLabel({ index: 6, label: 'x', description: '', clock: '2026-10-13T00:00:00Z' }, 7)).toBe(
      'Day 7 of 7 (2026-10-13 UTC)',
    );
    const text = flat(buildBriefing(input({ step: { ...step, label: 'Day 3 of 7 (2026-10-02 UTC)' } })));
    expect(text).toContain('Replay step: Day 3 of 7 (2026-10-02 UTC)');
    expect(text).not.toContain('Step label:');
  });
});

describe('briefingFilename', () => {
  it('has the documented shape for replay and static incidents', () => {
    expect(briefingFilename({ ...incident, id: 'watch-merapi' }, step)).toBe(
      'asean-watch-brief_watch-merapi_day-3.txt',
    );
    expect(briefingFilename(incident, null)).toBe('asean-watch-brief_inc-test-volcano_static.txt');
    expect(briefingFilename({ ...incident, replayable: false }, step)).toBe(
      'asean-watch-brief_inc-test-volcano_static.txt',
    );
  });

  it('is filesystem-safe for hostile ids', () => {
    for (const id of ['../../etc/passwd', 'a:b*c?"<>|', 'CON', '   ', 'inc merapi/demo\\x']) {
      const name = briefingFilename({ ...incident, id }, step);
      expect(name).toMatch(/^asean-watch-brief_[A-Za-z0-9._-]+_(day-\d+|static)\.txt$/);
      expect(name).not.toContain('..');
    }
  });
});
