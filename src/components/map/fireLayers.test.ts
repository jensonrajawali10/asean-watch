import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fireCells, loadFireSnapshot, regionalBadges } from '../../lib/fires';
import { loadWindSnapshot } from '../../lib/windField';
import { FireCard } from './FireCard';
import { FIRE_COLORS, buildFireLayers, fireColor, firePickFromInfo, isFireLayerId } from './fireLayers';
import type { FirePick } from './fireLayers';
import { getMapPalette } from './mapPalette';

// The bundled snapshots are lazy chunks (loaded with await).
const WIND925 = await loadWindSnapshot('925hPa');

const snap = loadFireSnapshot()!;
const noop = () => {};
const ids = (layers: { id: string }[]) => layers.map((l) => l.id);

describe('buildFireLayers', () => {
  it('draws nothing without a snapshot or when hidden', () => {
    expect(buildFireLayers({ snapshot: null, theme: 'dark', zoom: 5 })).toEqual([]);
    expect(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 5, visible: false })).toEqual([]);
  });

  it('shows glow and province badges at regional zoom, squares and cluster badges closer in, and no badges up close', () => {
    const far = ids(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 4 }));
    expect(far).toEqual(expect.arrayContaining(['fires-glow-older', 'fires-glow-24h', 'fires-badges']));
    expect(far.some((id) => id.startsWith('fires-cells-'))).toBe(false);

    const mid = buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 6 });
    expect(ids(mid)).toEqual(expect.arrayContaining(['fires-cells-older-0.25', 'fires-cells-24h-0.25', 'fires-badges']));
    const badges = mid.find((l) => l.id === 'fires-badges')!;
    const data = badges.props.data as { cluster: unknown }[];
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((d) => d.cluster !== null)).toBe(true);

    expect(ids(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 8 }))).not.toContain('fires-badges');
    for (const id of mid.map((l) => l.id)) expect(isFireLayerId(id)).toBe(true);
  });

  it('can show the last 24 h only, and rings the selected cluster', () => {
    const only = ids(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 6, window: '24h' }));
    expect(only.some((id) => id.includes('older'))).toBe(false);
    const sel = ids(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 6, selectedClusterId: snap.clusters24h[0].id }));
    expect(sel).toContain('fires-selected');
  });

  it('calm squares (simple view): the same cells at the given fraction of their alpha', () => {
    const full = buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 5 }).find((l) => l.id === 'fires-cells-24h-0.25')!;
    const calm = buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 5, cellStrength: 0.5 }).find((l) => l.id === 'fires-cells-24h-0.25')!;
    const cell = (full.props.data as unknown[])[0];
    const alpha = (l: typeof full) => (l.props as unknown as { getFillColor: (c: unknown) => number[] }).getFillColor(cell)[3];
    expect(alpha(calm)).toBeCloseTo(alpha(full) * 0.5, -0.5); // the option scales linearly; the simple view uses 0.35
    expect(alpha(calm)).toBeLessThan(alpha(full));
  });

  it('separated squares at a city (simple view): closeCoverage from zoom 5, the usual coverage otherwise', () => {
    const cov = (zoom: number, closeCoverage?: number) =>
      (buildFireLayers({ snapshot: snap, theme: 'dark', zoom, closeCoverage }).find((l) => l.id === 'fires-cells-24h-0.25')!.props as unknown as { coverage: number }).coverage;
    expect(cov(4.8)).toBe(0.9);
    expect(cov(6.5)).toBe(0.8);
    expect(cov(4.8, 0.55)).toBe(0.9); // the regional view keeps its squares whole
    expect(cov(5, 0.55)).toBe(0.55);
    expect(cov(6.5, 0.55)).toBe(0.55);
    expect(cov(6.5, 0.01)).toBe(0.2); // never a speck
  });

  it('blends additively on dark and normally on light', () => {
    const dark = buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 6 }).find((l) => l.id === 'fires-cells-24h-0.25')!;
    const light = buildFireLayers({ snapshot: snap, theme: 'light', zoom: 6 }).find((l) => l.id === 'fires-cells-24h-0.25')!;
    expect((dark.props.parameters as { blendColorDstFactor: string }).blendColorDstFactor).toBe('one');
    expect((light.props.parameters as { blendColorDstFactor: string }).blendColorDstFactor).toBe('one-minus-src-alpha');
  });
});

describe('colours', () => {
  it('has a palette per theme and gets brighter with FRP on dark, darker on light', () => {
    expect(Object.keys(FIRE_COLORS).sort()).toEqual(['dark', 'light']);
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(fireColor(5, 'dark', 255))).toBeLessThan(lum(fireColor(500, 'dark', 255)));
    expect(lum(fireColor(500, 'dark', 255))).toBeLessThan(lum(fireColor(5000, 'dark', 255)));
    expect(lum(fireColor(5, 'light', 255))).toBeGreaterThan(lum(fireColor(5000, 'light', 255)));
    expect(fireColor(100, 'dark', 77)[3]).toBe(77);
  });

  it('takes the light palette from mapPalette and keeps it off the reserved official red', () => {
    expect(FIRE_COLORS.light).toBe(getMapPalette('light').fireGrid);
    const hue = ([r, g, b]: readonly number[]) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      return (h * 60 + 360) % 360;
    };
    const light = FIRE_COLORS.light;
    for (const c of [...light.ramp.map((s) => s[1]), light.badgeBg, light.badgeBorder]) {
      expect(hue(c)).toBeGreaterThanOrEqual(12);
      expect(hue(c)).toBeLessThanOrEqual(45);
    }
  });

  it('draws the light squares at every zoom (a normally blended glow alone is too faint)', () => {
    expect(ids(buildFireLayers({ snapshot: snap, theme: 'light', zoom: 3.5 }))).toContain('fires-cells-24h-0.25');
    expect(ids(buildFireLayers({ snapshot: snap, theme: 'dark', zoom: 3.5 })).some((id) => id.startsWith('fires-cells-'))).toBe(false);
  });
});

describe('firePickFromInfo', () => {
  it('turns picks into typed fire objects and ignores other layers', () => {
    const cell = fireCells(snap, '24h')[0];
    expect(firePickFromInfo({ layer: { id: 'fires-cells-24h-0.25' } as never, object: cell })).toEqual({ kind: 'fire-cell', cell, recent: true });
    expect(firePickFromInfo({ layer: { id: 'fires-cells-older-0.25' } as never, object: cell })).toMatchObject({ recent: false });
    const cluster = snap.clusters24h[0];
    expect(firePickFromInfo({ layer: { id: 'fires-badges' } as never, object: { cluster, badge: null } })).toEqual({ kind: 'fire-cluster', cluster });
    const badge = regionalBadges(snap)[0];
    expect(firePickFromInfo({ layer: { id: 'fires-badges' } as never, object: { cluster: null, badge } })).toEqual({ kind: 'fire-region', badge });
    expect(firePickFromInfo({ layer: { id: 'haze-cities-modelled' } as never, object: cell })).toBeNull();
    expect(firePickFromInfo(null)).toBeNull();
  });
});

describe('FireCard', () => {
  const render = (pick: FirePick, withWind = false) =>
    renderToStaticMarkup(
      createElement(FireCard, { pick, snapshot: snap, windGrid: withWind ? WIND925 : null, onOpenWorkspace: noop, onClose: noop }),
    );

  it('shows a cluster as three measured facts, one sentence, the trend and the workspace link', () => {
    const c = snap.clusters24h[0];
    const html = render({ kind: 'fire-cluster', cluster: c });
    expect(html).toContain('MEASURED · FIRMS');
    expect(html).toContain('Hotspots, 24 h');
    expect(html).toContain('Fire power, 24 h');
    expect(html).toContain('vs previous 24 h');
    expect(html).toContain('Open full data');
    // "the last 24 h" while the bundled snapshot is recent, else dated (fireWindowWords, tested in fires.test.ts).
    expect(html).toMatch(/hotspots in (the last 24 h|the 24 h to \d{1,2} [A-Z][a-z]{2}) around/);
    expect(html).not.toMatch(/tonne|CO2|—/);
  });

  it('adds the MODELLED smoke heading when a 925 hPa wind grid is given and the cluster is inside it', () => {
    const inside = snap.clusters24h.find((c) => c.lat > -6 && c.lat < 8 && c.lon > 95 && c.lon < 120);
    expect(inside).toBeTruthy();
    const html = render({ kind: 'fire-cluster', cluster: inside! }, true);
    expect(html).toContain('MODELLED');
    expect(html).toContain('not a dispersion model');
  });

  it('shows a cell inside a cluster as that cluster, and a region badge as the region', () => {
    const c = snap.clusters24h[0];
    const cell = fireCells(snap, '24h').find((x) => c.cells.includes(x.index))!;
    expect(render({ kind: 'fire-cell', cell, recent: true })).toContain(c.name.replace(/&/g, '&amp;'));
    const badge = regionalBadges(snap)[0];
    expect(render({ kind: 'fire-region', badge })).toContain(badge.name);
  });
});
