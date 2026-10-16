import { describe, expect, it } from 'vitest';
import { distanceKm, loadAshWindSnapshot } from './ashDrift';
import type { AshWindSeries } from './ashDrift';
import {
  PUFF_SPREAD_KM_PER_H,
  PUFF_START_RADIUS_KM,
  SCENARIO_DEFAULT_HOURS,
  VOLCANO_TOWNS,
  arrivalsBy,
  buildEruptionScenario,
  chainsAt,
  buildScenarioFromSeries,
  footprintAt,
  footprintRings,
  frontPathsAt,
  hoursPhrase,
  plumeCirclesAt,
  puffRadiusKm,
  puffsAt,
  scenarioPlaces,
  scenarioWindow,
} from './eruptionScenario';
import type { EruptionScenario, LonLat, Ring, ScenarioPlace } from './eruptionScenario';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-14T00:00:00Z');
const VENT = { lat: -7.54, lon: 110.446 };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function makeSeries(
  hours: number,
  w: Partial<Record<'700' | '500' | '300', { speed: number; dir: number }>>,
  base: { speed: number; dir: number } = { speed: 10, dir: 90 },
): AshWindSeries {
  const times = Array.from({ length: hours }, (_, k) => iso(T0 + k * HOUR));
  const lvl = (l: '700' | '500' | '300') => {
    const x = w[l] ?? base;
    return { speed: times.map(() => x.speed), dir: times.map(() => x.dir) };
  };
  return { volcanoId: 'gvp-263250', name: 'Merapi', lat: VENT.lat, lon: VENT.lon, times, wind: { '700': lvl('700'), '500': lvl('500'), '300': lvl('300') } };
}

/** A place `km` from the vent along `bearing` (flat approximation, fine for tests). */
function placeAt(id: string, km: number, bearing: number): ScenarioPlace {
  const b = (bearing * Math.PI) / 180;
  const lat = VENT.lat + (km * Math.cos(b)) / 110.574;
  const lon = VENT.lon + (km * Math.sin(b)) / (111.32 * Math.cos((VENT.lat * Math.PI) / 180));
  return { id, name: id, country: 'ID', province: 'Central Java', lat, lon, source: 'test' };
}

function pointInRing(p: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inAny = (p: LonLat, rings: Ring[]) => rings.some((r) => pointInRing(p, r));

describe('scenarioWindow', () => {
  const s = makeSeries(72, {});
  it('starts at the hour at or before now and caps the length at 48 h and at the data', () => {
    expect(scenarioWindow(s, T0 + 2.5 * HOUR, 24)).toEqual({ startMs: T0 + 2 * HOUR, hours: 24, shifted: false });
    expect(scenarioWindow(s, T0, 100)?.hours).toBe(48);
    expect(scenarioWindow(s, T0 + 60 * HOUR, 24)).toEqual({ startMs: T0 + 60 * HOUR, hours: 11, shifted: false });
  });
  it('shifts the start (and says so) when a stale series has too little left', () => {
    const w = scenarioWindow(s, T0 + 200 * HOUR, 24);
    expect(w).toEqual({ startMs: T0 + 47 * HOUR, hours: 24, shifted: true });
    expect(scenarioWindow(s, T0 - 5 * HOUR, 24)?.shifted).toBe(true);
  });
});

describe('buildScenarioFromSeries: a constant 10 m/s easterly (blowing west)', () => {
  const sc = buildScenarioFromSeries(makeSeries(40, {}), T0, { places: [placeAt('west72', 72, 270), placeAt('east20', 20, 90)] }) as EruptionScenario;

  it('makes hourly frames with one new puff per height per hour, from the start to the end of the eruption', () => {
    expect(sc.hours).toBe(SCENARIO_DEFAULT_HOURS);
    expect(sc.emissionHours).toBe(24);
    expect(sc.frames).toHaveLength(25);
    expect(sc.frames[0].puffs).toHaveLength(3);
    expect(sc.frames[5].puffs).toHaveLength(18);
    expect(sc.frames[24].puffs).toHaveLength(75);
    expect(sc.frames[3].time).toBe('2026-10-14T03:00:00Z');
  });

  it('moves the front 36 km per hour due west and grows radii linearly', () => {
    const front = sc.frames[10].puffs.find((p) => p.level === '500' && p.emittedH === 0)!;
    expect(distanceKm(VENT.lat, VENT.lon, front.lat, front.lon)).toBeCloseTo(360, -1);
    expect(front.lon).toBeLessThan(VENT.lon);
    expect(Math.abs(front.lat - VENT.lat)).toBeLessThan(0.05);
    expect(front.radiusKm).toBeCloseTo(PUFF_START_RADIUS_KM + 10 * PUFF_SPREAD_KM_PER_H, 9);
    expect(puffRadiusKm(0)).toBe(PUFF_START_RADIUS_KM);
    const ticks = sc.levels.find((l) => l.level === '700')!.ticks;
    expect(ticks.map((t) => t.hour)).toEqual([3, 6, 12, 24]);
    expect(ticks[0].distanceKm).toBeCloseTo(108, 0);
  });

  it('times first arrival when a place enters a puff, and never reaches upwind places', () => {
    // 72 - 36 t <= 5 + 3.6 t  ->  t >= 1.69 h; the next 10-minute step is 1 h 50 min.
    expect(sc.arrivals.map((a) => a.place.id)).toEqual(['west72']);
    expect(sc.arrivals[0].hours).toBeCloseTo(110 / 60, 6);
    expect(sc.arrivals[0].time).toBe('2026-10-14T01:50:00Z');
    expect(Object.keys(sc.arrivals[0].byLevel).sort()).toEqual(['300', '500', '700']);
    expect(arrivalsBy(sc, T0 + 1.5 * HOUR)).toHaveLength(0);
    expect(arrivalsBy(sc, T0 + 2 * HOUR)).toHaveLength(1);
  });

  it('heads west in the summary, names the place and carries the caveats', () => {
    const s = sc.summary;
    expect(s.label).toBe('MODELLED SCENARIO');
    expect(s.sentence).toBe('If Merapi erupted now, ash at about 5.5–9 km would drift west; modelled to pass near west72 within about 2 h (ash at about 3 km).');
    expect(s.caveats.join(' ')).toMatch(/not a prediction/);
    expect(s.caveats.join(' ')).toMatch(/Not a dispersion model/);
    expect(s.caveats.join(' ')).toMatch(/Not a VAAC advisory/);
    expect(s.caveats.join(' ')).toMatch(/eruption is assumed/);
    for (const text of [s.sentence, ...s.caveats]) {
      expect(text).not.toMatch(/evacuat/i);
      expect(text).not.toContain('—');
    }
  });

  it('footprint rings enclose every puff centre and trace the vent puff at 5 km', () => {
    for (const h of [0, 6, 24]) {
      const f = sc.frames[h];
      expect(f.footprint.length).toBeGreaterThan(0);
      for (const p of f.puffs) expect(inAny([p.lon, p.lat], f.footprint)).toBe(true);
      for (const ring of f.footprint) expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
    for (const [lon, lat] of sc.frames[0].footprint[0]) {
      const d = distanceKm(VENT.lat, VENT.lon, lat, lon);
      expect(d).toBeGreaterThan(4.3);
      expect(d).toBeLessThan(5.7);
    }
    const [w, s, e, n] = sc.bounds;
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });

  it('interpolates puffs and the front path between hours; nothing before the start; held after the end', () => {
    expect(puffsAt(sc, T0 - 1)).toEqual([]);
    const mid = puffsAt(sc, T0 + 1.5 * HOUR).find((p) => p.level === '700' && p.emittedH === 0)!;
    expect(distanceKm(VENT.lat, VENT.lon, mid.lat, mid.lon)).toBeCloseTo(54, 0);
    expect(mid.ageH).toBeCloseTo(1.5, 9);
    const byKey = (ps: { level: string; emittedH: number }[]) => [...ps].sort((a, b) => a.level.localeCompare(b.level) || a.emittedH - b.emittedH);
    expect(byKey(puffsAt(sc, T0 + 99 * HOUR))).toEqual(byKey(sc.frames[24].puffs));
    expect(byKey(puffsAt(sc, T0 + 3 * HOUR))).toEqual(byKey(sc.frames[3].puffs));
    // Between whole hours the vent is still erupting: the chain starts at the vent.
    const chain = chainsAt(sc, T0 + 2.5 * HOUR).find((c) => c.level === '500')!.circles;
    expect(chain[0]).toMatchObject({ ageH: 0, lat: VENT.lat, lon: VENT.lon });
    expect(chain.map((c) => c.ageH)).toEqual([0, 0.5, 1.5, 2.5]);
    // Densified circles overlap their neighbours (no hourly beads).
    const circles = plumeCirclesAt(sc, T0 + 2.5 * HOUR, ['500']);
    for (let k = 0; k + 1 < circles.length; k++) {
      const a = circles[k];
      const b = circles[k + 1];
      expect(distanceKm(a.lat, a.lon, b.lat, b.lon)).toBeLessThanOrEqual(0.51 * Math.min(a.radiusKm, b.radiusKm));
    }
    const trail = frontPathsAt(sc, T0 + 2.5 * HOUR).find((t) => t.level === '300')!;
    expect(trail.path).toHaveLength(4);
    expect(footprintAt(sc, T0 + 2.5 * HOUR).length).toBeGreaterThan(0);
    expect(footprintAt(sc, T0 + 6 * HOUR)).toBe(sc.frames[6].footprint);
  });

  it('is deterministic', () => {
    const again = buildScenarioFromSeries(makeSeries(40, {}), T0, { places: [placeAt('west72', 72, 270), placeAt('east20', 20, 90)] });
    expect(again).toEqual(sc);
  });
});

describe('summary wording', () => {
  it('splits the direction when the two upper heights diverge', () => {
    const sc = buildScenarioFromSeries(makeSeries(40, { '500': { speed: 10, dir: 90 }, '300': { speed: 10, dir: 270 } }), T0, { places: [] })!;
    expect(sc.summary.direction).toBe('If Merapi erupted now, ash at about 5.5 km would drift west and ash at about 9 km east');
    expect(sc.summary.directionWords).toBeNull();
    expect(sc.summary.places).toMatch(/no listed town .* not an all-clear/);
  });

  it('says the ash stays close to the summit in calm air', () => {
    const sc = buildScenarioFromSeries(makeSeries(40, {}, { speed: 0.2, dir: 0 }), T0, { places: [] })!;
    expect(sc.summary.direction).toMatch(/stay close to the summit/);
  });

  it('names a turn when the wind backs later in the scenario', () => {
    const s = makeSeries(40, {});
    for (const l of ['500', '300'] as const) s.wind[l].dir = s.wind[l].dir.map((_, k) => (k < 8 ? 90 : 180));
    const sc = buildScenarioFromSeries(s, T0, { places: [] })!;
    expect(sc.summary.direction).toMatch(/would drift (west|west-north-west), then turn north/);
  });

  it('phrases hours plainly', () => {
    expect(hoursPhrase(0.5)).toBe('within the first hour');
    expect(hoursPhrase(1.83)).toBe('within about 2 h');
  });
});

describe('wind gaps and limits', () => {
  it('stops at the first missing wind value instead of inventing one', () => {
    const s = makeSeries(40, {});
    s.wind['300'].speed[10] = Number.NaN;
    const sc = buildScenarioFromSeries(s, T0, { hours: 24, places: [] })!;
    expect(sc.hours).toBe(9);
    expect(sc.frames).toHaveLength(10);
  });
  it('honours emissionHours and the 48 h cap', () => {
    const sc = buildScenarioFromSeries(makeSeries(60, {}), T0, { hours: 72, emissionHours: 6, places: [] })!;
    expect(sc.hours).toBe(48);
    expect(sc.frames[48].puffs).toHaveLength(21);
    // After the eruption ends the chain no longer starts at the vent.
    expect(chainsAt(sc, T0 + 10 * HOUR)[0].circles[0].ageH).toBe(4);
  });
});

describe('footprintRings', () => {
  it('returns one ring per separate patch and joins a chain into one tapered capsule', () => {
    expect(footprintRings([])).toEqual([]);
    const a = { lat: 0, lon: 100, radiusKm: 20 };
    const b = { lat: 0, lon: 103, radiusKm: 40 };
    const separate = footprintRings([[a], [b]]);
    expect(separate).toHaveLength(2);
    expect(inAny([101.5, 0], separate)).toBe(false);
    const joined = footprintRings([[a, b]]);
    expect(joined).toHaveLength(1);
    // Mid-link the radius is 30 km: inside at 25 km off the axis, outside at 35 km.
    expect(inAny([101.5, 25 / 110.574], joined)).toBe(true);
    expect(inAny([101.5, 35 / 110.574], joined)).toBe(false);
    expect(inAny([104, 0], joined)).toBe(false);
  });
});

describe('places', () => {
  it('lists the volcano towns first, then the other towns and the air-quality cities, without duplicates', () => {
    const p = scenarioPlaces('gvp-263250');
    expect(p[0].name).toBe('Yogyakarta');
    expect(new Set(p.map((x) => x.id)).size).toBe(p.length);
    expect(p.some((x) => x.id === 'singapore')).toBe(true);
    expect(p.some((x) => x.id === 'cilegon')).toBe(true);
    expect(p.find((x) => x.id === 'dumai')?.name).toBe('Dumai');
    for (const x of p) {
      expect(Number.isFinite(x.lat) && Number.isFinite(x.lon)).toBe(true);
      expect(x.source.length).toBeGreaterThan(0);
    }
  });
  it('bundled towns sit within 200 km of their volcano', () => {
    const snap = loadAshWindSnapshot()!;
    for (const [id, towns] of Object.entries(VOLCANO_TOWNS)) {
      const v = snap.volcanoes.find((x) => x.volcanoId === id)!;
      for (const t of towns) {
        if (t.id === 'denpasar' || t.id === 'surabaya' || t.id === 'semarang') continue;
        expect(distanceKm(v.lat, v.lon, t.lat, t.lon), t.id).toBeLessThan(200);
      }
    }
  });
});

describe('with the bundled ash-wind snapshot', () => {
  const snap = loadAshWindSnapshot()!;
  const now = Date.parse(snap.retrievedAt);
  it('builds a 24 h and a 48 h scenario for each watched volcano', () => {
    for (const v of snap.volcanoes) {
      const sc = buildEruptionScenario(snap, v.volcanoId, now)!;
      expect(sc, v.name).not.toBeNull();
      expect(sc.hours).toBe(24);
      expect(sc.startShifted).toBe(false);
      expect(sc.wind?.dataMode).toBe('historical');
      expect(sc.summary.sentence).toMatch(new RegExp(`^If ${v.name} erupted now, ash at`));
      for (const a of sc.arrivals) expect(a.hours).toBeLessThanOrEqual(24);
      expect(buildEruptionScenario(snap, v.volcanoId, now, { hours: 48 })?.hours).toBe(48);
    }
    expect(buildEruptionScenario(snap, 'gvp-262000', now, { name: 'Anak Krakatau' })?.summary.sentence).toMatch(/^If Anak Krakatau erupted now/);
    expect(buildEruptionScenario(snap, 'gvp-000000', now)).toBeNull();
    expect(buildEruptionScenario(null, 'gvp-263250', now)).toBeNull();
  });
});
