import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnectorCaches } from './liveLoad';
import {
  bundledFloodSnapshot,
  FLOOD_MODEL_NOTE,
  floodApiUrl,
  loadFloodModel,
  loadFloodModelSnapshot,
  neighbourhood,
  parseFloodResponse,
  pickBestCell,
  RIVER_POINTS,
} from './floodModel';

// The bundled snapshot is a lazy chunk.
const BUNDLED_FLOOD_SNAPSHOT = (await bundledFloodSnapshot())!;

// Trimmed real Open-Meteo Flood API cells from data/flood-snapshot.json (2026-10-14):
// the first 25 cells around Phnom Penh, as returned (a minor channel next to the Mekong mainstream).
const raw = BUNDLED_FLOOD_SNAPSHOT.raw as { latitude: number; longitude: number; daily: { time: string[]; river_discharge: (number | null)[] } }[];
const MEKONG = raw.slice(0, 25);

beforeEach(() => resetConnectorCaches());

describe('neighbourhood search', () => {
  it('builds a 5×5 grid at 0.05° around each point', () => {
    const n = neighbourhood(14.35, 100.56);
    expect(n.lats).toHaveLength(25);
    expect(n.lats[0]).toBe('14.250');
    expect(n.lons[0]).toBe('100.460');
    expect(n.lats[24]).toBe('14.450');
    expect(n.lons[24]).toBe('100.660');
    const url = floodApiUrl();
    expect(url).toContain('daily=river_discharge&past_days=7&forecast_days=8');
    expect(url.split('latitude=')[1].split('&')[0].split(',')).toHaveLength(25 * RIVER_POINTS.length);
  });

  it('picks the cell with the highest mean discharge, not the requested cell', () => {
    const cells = MEKONG.map((c) => ({ lat: c.latitude, lon: c.longitude, time: c.daily.time, q: c.daily.river_discharge }));
    const best = pickBestCell(cells, 11.55, 104.92)!;
    const means = cells.map((c) => c.q.reduce((a: number, b) => a + (b ?? 0), 0) / c.q.length);
    expect(Math.max(...means)).toBeGreaterThan(10000); // the Mekong mainstream
    expect(best.q.reduce((a: number, b) => a + (b ?? 0), 0) / best.q.length).toBe(Math.max(...means));
  });
});

describe('parseFloodResponse', () => {
  it('returns MODELLED m³/s for each river point with past, today and forecast days', () => {
    const series = parseFloodResponse(raw, { dataMode: 'historical', retrievedAt: BUNDLED_FLOOD_SNAPSHOT.retrievedAt, sourceUrl: 'u' });
    expect(series.map((s) => s.pointId)).toEqual(RIVER_POINTS.map((p) => p.id));
    for (const s of series) {
      expect(s).toMatchObject({ unit: 'm³/s', basis: 'MODELLED', dataMode: 'historical' });
      expect(s.note).toBe(FLOOD_MODEL_NOTE);
      expect(s.days.filter((d) => d.kind === 'past')).toHaveLength(7);
      expect(s.days.filter((d) => d.kind === 'today')).toHaveLength(1);
      expect(s.days.filter((d) => d.kind === 'forecast')).toHaveLength(7);
      expect(Math.abs(s.cell.lat - s.requested.lat)).toBeLessThanOrEqual(0.11);
      expect(Math.abs(s.cell.lon - s.requested.lon)).toBeLessThanOrEqual(0.11);
    }
    const mekong = series[0].days.find((d) => d.kind === 'today')!.dischargeM3s!;
    expect(mekong).toBeGreaterThan(1000);
  });

  it('is never worded as a warning', () => {
    expect(FLOOD_MODEL_NOTE).toMatch(/MODELLED/);
    expect(FLOOD_MODEL_NOTE).toMatch(/not a flood warning/);
  });

  it('rejects a payload of the wrong shape', () => {
    expect(() => parseFloodResponse(MEKONG, { dataMode: 'live', retrievedAt: '2026-10-14T00:00:00Z', sourceUrl: 'u' })).toThrow();
  });
});

describe('loadFloodModel', () => {
  it('live, then HISTORICAL snapshot, then unavailable', async () => {
    const ok = (async () => new Response(JSON.stringify(raw), { status: 200 })) as unknown as typeof fetch;
    const live = await loadFloodModel({ fetchImpl: ok });
    expect(live.status.status).toBe('live');
    expect(live.series[0].dataMode).toBe('live');

    resetConnectorCaches();
    const down = (async () => new Response('{"error":true}', { status: 400 })) as unknown as typeof fetch;
    const snap = await loadFloodModel({ fetchImpl: down });
    expect(snap.status.status).toBe('snapshot');
    expect(snap.series).toHaveLength(4);
    expect(loadFloodModelSnapshot(BUNDLED_FLOOD_SNAPSHOT).series[0].dataMode).toBe('historical');

    resetConnectorCaches();
    const none = await loadFloodModel({ fetchImpl: down, snapshot: null });
    expect(none.series).toEqual([]);
    expect(none.status.status).toBe('unavailable');
  });
});
