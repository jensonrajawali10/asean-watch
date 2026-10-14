import { describe, expect, it } from 'vitest';
import gibsCheck from '../../data/gibs-snapshot.json';
import {
  GIBS_LAYERS,
  gibsTileTemplate,
  himawariIrLayer,
  himawariTime,
  himawariTimes,
  isHimawariGap,
  trueColourLayer,
  yesterdayUtc,
} from './gibs';

const at = (iso: string) => Date.parse(iso);

describe('Himawari time rounding', () => {
  it('subtracts the 60 min safe lag and floors to the 10-minute slot', () => {
    expect(himawariTime(at('2026-10-14T11:47:42Z'))).toBe('2026-10-14T10:40:00Z');
    expect(himawariTime(at('2026-10-14T11:50:00Z'))).toBe('2026-10-14T10:50:00Z');
    expect(himawariTime(at('2026-10-14T11:59:59Z'))).toBe('2026-10-14T10:50:00Z');
  });

  it('crosses midnight UTC', () => {
    expect(himawariTime(at('2026-10-15T00:05:00Z'))).toBe('2026-10-14T23:00:00Z');
  });

  it('steps back over the 02:40 and 14:40 UTC gaps GIBS never has', () => {
    expect(isHimawariGap(at('2026-10-14T02:40:00Z'))).toBe(true);
    expect(isHimawariGap(at('2026-10-14T14:40:00Z'))).toBe(true);
    expect(isHimawariGap(at('2026-10-14T03:40:00Z'))).toBe(false);
    expect(himawariTime(at('2026-10-14T03:45:00Z'))).toBe('2026-10-14T02:30:00Z');
    expect(himawariTime(at('2026-10-14T15:41:00Z'))).toBe('2026-10-14T14:30:00Z');
  });

  it('lists consecutive slots oldest first, skipping gaps', () => {
    expect(himawariTimes(at('2026-10-14T03:55:00Z'), 4)).toEqual([
      '2026-10-14T02:10:00Z',
      '2026-10-14T02:20:00Z',
      '2026-10-14T02:30:00Z',
      '2026-10-14T02:50:00Z',
    ]);
  });

  it('yesterday UTC for the daily true-colour mosaic', () => {
    expect(yesterdayUtc(at('2026-10-14T00:30:00Z'))).toBe('2026-10-13');
    expect(yesterdayUtc(at('2026-10-14T23:59:00Z'))).toBe('2026-10-13');
  });
});

describe('tile URL templates', () => {
  it('Himawari clean IR: EPSG:3857 WMTS REST, Level6 PNG, maxzoom 6', () => {
    const l = himawariIrLayer(at('2026-10-14T11:47:42Z'));
    expect(l.tiles).toEqual([
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/2026-10-14T10:40:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    ]);
    expect(l).toMatchObject({ tileSize: 256, maxzoom: 6, timeISO: '2026-10-14T10:40:00Z', dataMode: 'live' });
    expect(l.attribution).toMatch(/NASA/);
    expect(l.attribution).toMatch(/JMA/);
    expect(l.latencyNote).toMatch(/10:40 UTC/);
  });

  it('VIIRS true colour for yesterday UTC: Level9 JPEG, maxzoom 9', () => {
    const l = trueColourLayer(at('2026-10-14T11:47:42Z'));
    expect(l.tiles[0]).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-13/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg',
    );
    expect(l).toMatchObject({ maxzoom: 9, timeISO: '2026-10-13' });
    expect(trueColourLayer(0, 'modis', '2026-10-13').tiles[0]).toContain('/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-10-13/');
  });

  it('matches the layers, tile matrix sets, formats and REST templates verified in GetCapabilities', () => {
    const verified = gibsCheck.layers as Record<string, { tileMatrixSet: string; format: string; template: string | null }>;
    for (const key of Object.keys(GIBS_LAYERS) as (keyof typeof GIBS_LAYERS)[]) {
      const cfg = GIBS_LAYERS[key];
      const v = verified[cfg.layer];
      expect(v, cfg.layer).toBeDefined();
      expect(v.tileMatrixSet).toBe(cfg.tileMatrixSet);
      expect(v.format).toBe(`image/${cfg.ext}`);
      expect(Number(cfg.tileMatrixSet.replace(/\D+/g, ''))).toBe(cfg.maxzoom);
      const expected = v.template!
        .replace('{Time}', 'T')
        .replace('{TileMatrixSet}', cfg.tileMatrixSet)
        .replace('{TileMatrix}', '{z}')
        .replace('{TileRow}', '{y}')
        .replace('{TileCol}', '{x}');
      expect(gibsTileTemplate(key, 'T')).toBe(expected);
    }
  });
});
