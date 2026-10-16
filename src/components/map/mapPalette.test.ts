import { describe, expect, it } from 'vitest';
import { PM25_BANDS } from '../../lib/airQuality';
import {
  cityBandStyle,
  compositeOver,
  contrastRatio,
  getMapPalette,
  hexRgb,
  luminance,
  rampRgba,
  rgbCss,
  themeOf,
  volcanoLevelColour,
} from './mapPalette';
import type { MapPalette, Rgb } from './mapPalette';

const dark = getMapPalette('dark');
const light = getMapPalette('light');

/** Worst contrast of a mark (at `alpha`) against every basemap surface of a palette. */
function worst(p: MapPalette, c: readonly number[], alpha = 1): number {
  return Math.min(
    ...[p.basemap.land, p.basemap.landTint, p.basemap.water].map((bg) => contrastRatio(compositeOver(c, alpha, bg), bg)),
  );
}

/** Reserved official red: a saturated red within 12° of pure red (#8a1f1f is 0°). */
function isOfficialRed(c: readonly number[]): boolean {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max !== r || max - min < 60) return false;
  const hue = (60 * (g - b)) / (max - min);
  return hue > -12 && hue < 12;
}

describe('helpers', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio(hexRgb('#777777'), [255, 255, 255])).toBeCloseTo(4.48, 1);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('composites and formats colours', () => {
    expect(compositeOver([0, 0, 0], 0.5, [255, 255, 255])).toEqual([128, 128, 128]);
    expect(rgbCss([1, 2, 3])).toBe('rgb(1, 2, 3)');
    expect(rgbCss([1, 2, 3, 255])).toBe('rgba(1, 2, 3, 1)');
    expect(hexRgb('#c8d3d9')).toEqual([200, 211, 217]);
  });

  it('interpolates a ramp on a log scale and is transparent for non-finite values', () => {
    const stops = [
      { v: 10, c: [0, 0, 0] as Rgb, a: 0 },
      { v: 100, c: [100, 100, 100] as Rgb, a: 1 },
    ];
    expect(rampRgba(stops, 5)[3]).toBe(0);
    expect(rampRgba(stops, Number.NaN)[3]).toBe(0);
    const mid = rampRgba(stops, Math.sqrt(1000));
    expect(mid.slice(0, 3)).toEqual([50, 50, 50]);
    expect(Math.abs(mid[3] - 127.5)).toBeLessThanOrEqual(1);
    expect(rampRgba(stops, 1e6)).toEqual([100, 100, 100, 255]);
  });

  it('maps themes and MAGMA levels', () => {
    expect(themeOf(true)).toBe('dark');
    expect(themeOf(false)).toBe('light');
    expect(themeOf(undefined)).toBe('dark');
    expect(getMapPalette()).toBe(dark);
    expect(getMapPalette(false)).toBe(light);
    expect([1, 2, 3, 4, 7, null].map(volcanoLevelColour)).toEqual(['green', 'yellow', 'orange', 'red', 'unknown', 'unknown']);
  });
});

describe('dark palette keeps the colours the map drew before', () => {
  it('particles, haze, city chrome and labels', () => {
    expect(dark.particles).toMatchObject({ color: [246, 239, 222], alpha: 0.5, width: 1.1, blend: 'additive' });
    expect(dark.haze.stops.map((s) => s.a)).toEqual([0, 0.14, 0.27, 0.42, 0.55]);
    expect(dark.city.glowBlend).toBe('additive');
    expect(dark.city.glowAlpha).toEqual({ rest: 170, focus: 230 });
    expect(dark.city.fireAreaOutline).toEqual([255, 176, 96, 255]);
    expect(dark.label).toEqual({ text: [243, 234, 216, 255], halo: [8, 10, 14, 235], haloWidth: 0.32 });
    expect(dark.quake.shallow).toEqual([242, 176, 64]);
    expect(dark.ash.lines['700']).toEqual([247, 239, 222]);
  });
});

describe('light palette (designed for a light basemap, not inverted)', () => {
  it('draws wind particles in dark slate ink with normal blending, >= 3:1 at the head', () => {
    expect(luminance(light.particles.color)).toBeLessThan(0.03);
    expect(light.particles.blend).toBe('normal');
    expect(worst(light, light.particles.color, light.particles.alpha)).toBeGreaterThanOrEqual(3);
  });

  it('draws haze as a warm smoke that darkens with PM2.5, reaching 3:1 at the top', () => {
    expect(light.haze.blend).toBe('multiply-like');
    const lums = [30, 60, 160, 300, 500].map((v) => {
      const c = rampRgba(light.haze.stops, v);
      return luminance(compositeOver(c, c[3] / 255, light.basemap.land));
    });
    for (let k = 1; k < lums.length; k += 1) expect(lums[k]).toBeLessThan(lums[k - 1]);
    for (const s of light.haze.stops) expect(s.c[0]).toBeGreaterThan(s.c[2]); // warm
    const top = light.haze.stops[light.haze.stops.length - 1];
    expect(worst(light, top.c, top.a)).toBeGreaterThanOrEqual(3);
    // Particles stay visible over the densest haze.
    const hazeTop = compositeOver(top.c, top.a, light.basemap.land);
    expect(contrastRatio(compositeOver(light.particles.color, light.particles.alpha, hazeTop), hazeTop)).toBeGreaterThan(2.5);
  });

  it('gives every PM2.5 band the legend fill, an ink outline >= 3:1 and haloed ink labels', () => {
    for (const b of PM25_BANDS) {
      const s = light.city.bands[b.key];
      expect(s.fill).toEqual(hexRgb(b.color));
      expect(worst(light, s.outline, s.outline[3] / 255)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(s.label, s.halo)).toBeGreaterThanOrEqual(4.5);
      expect(worst(light, s.label)).toBeGreaterThanOrEqual(4.5);
    }
    expect(cityBandStyle(light, 80)).toBe(light.city.bands.unhealthy);
    expect(cityBandStyle(light, Number.NaN)).toBe(light.city.unknown);
    expect(light.city.glowBlend).toBe('normal');
  });

  it('keeps marks, lines and outlines >= 3:1 on land and sea', () => {
    const marks: [string, readonly number[], number?][] = [
      ['fire-area outline', light.city.fireAreaOutline],
      ['NEA ring', light.city.neaRing],
      ['volcano', light.volcano.fill],
      ['distance ring', light.rings.line, light.rings.line[3] / 255],
      ['hotspot', light.fire.hotspot],
      ['official', light.official.stroke],
      ['tide', light.tide.fill, light.tide.fill[3] / 255],
      ['river', light.river.fill, light.river.fill[3] / 255],
      ['modelled path', light.modelled.path],
      ['plume footprint', light.ash.plume.footprint, light.ash.plume.footprint[3] / 255],
      ['plume place line', light.ash.plume.placeLine],
      ['NEA wind', light.nea.windInk],
      ['selection', light.selection.ring],
      ...Object.entries(light.volcano.levelRing).map(([k, c]): [string, readonly number[]] => [`level ${k}`, c]),
      ...Object.entries(light.ash.lines).map(([k, c]): [string, readonly number[]] => [`ash ${k}`, c]),
      ...Object.entries(light.quake).map(([k, c]): [string, readonly number[]] => [`quake ${k}`, c]),
      ...Object.entries(light.tsunami).map(([k, c]): [string, readonly number[]] => [`tsunami ${k}`, c.stroke]),
    ];
    for (const [name, c, a] of marks) expect([name, worst(light, c, a ?? 1) >= 3]).toEqual([name, true]);
  });

  it('keeps the FRP heat grid off the official red, >= 3:1 from 120 MW on land', () => {
    const g = light.fireGrid;
    expect(g.blend).toBe('normal');
    for (const [v, c] of g.ramp) {
      expect(isOfficialRed(c)).toBe(false);
      if (v >= 120) expect(worst({ ...light, basemap: { ...light.basemap, water: light.basemap.land } }, c, g.cell24h / 255)).toBeGreaterThanOrEqual(3);
    }
    expect(isOfficialRed(g.badgeBg)).toBe(false);
    expect(contrastRatio(g.badgeText, g.badgeBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(g.regionBadgeText, g.regionBadgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps fire cells from 50 MW >= 3:1 and uses normal blending', () => {
    expect(light.fire.blend).toBe('normal');
    for (const s of light.fire.stops.filter((x) => x.v >= 50)) expect(worst(light, s.c, s.a)).toBeGreaterThanOrEqual(3);
  });
});

describe('both themes', () => {
  it('keep the selection ring >= 3:1 on every basemap surface', () => {
    for (const p of [dark, light]) expect(worst(p, p.selection.ring)).toBeGreaterThanOrEqual(3);
  });

  it('keep dark-map marks >= 3:1 on Dark Matter land and sea', () => {
    expect(worst(dark, dark.particles.color, dark.particles.alpha)).toBeGreaterThanOrEqual(3);
    for (const c of Object.values(dark.quake)) expect(worst(dark, c)).toBeGreaterThanOrEqual(3);
    expect(worst(dark, dark.label.text)).toBeGreaterThanOrEqual(4.5);
  });

  it('reserve the official red for official warnings and the issuers’ own top levels', () => {
    for (const p of [dark, light]) {
      const ours = [
        ...p.fire.stops.map((s) => s.c),
        p.fire.hotspot,
        ...Object.values(p.quake),
        p.particles.color,
        ...p.haze.stops.map((s) => s.c),
        p.selection.ring,
        p.modelled.path,
        ...Object.values(p.ash.lines),
      ];
      for (const c of ours) expect(isOfficialRed(c)).toBe(false);
      for (const [r, g] of Object.values(p.quake)) expect(r > 190 && g < 110).toBe(false);
    }
    expect(isOfficialRed(light.official.fill)).toBe(true);
  });
});
