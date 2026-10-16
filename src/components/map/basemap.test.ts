import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_BUILDING_SOURCES, basemapStyleFor, basemapStyleOptions, buildingPaint, safeTransformStyle, transformStyle } from './basemap';
import { getMapPalette, hexRgb } from './mapPalette';

// A trimmed CARTO Positron style: the layer shapes transformStyle looks at.
function positron(): StyleSpecification {
  return {
    version: 8,
    sources: { carto: { type: 'vector', url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fafaf8' } },
      { id: 'water', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': '#d4dadc' } },
      { id: 'water_shadow', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': 'transparent' } },
      { id: 'waterway', type: 'line', source: 'carto', 'source-layer': 'waterway', paint: { 'line-color': '#d1dbdf' } },
      {
        id: 'boundary_state',
        type: 'line',
        source: 'carto',
        'source-layer': 'boundary',
        filter: ['all', ['==', 'admin_level', 4], ['==', 'maritime', 0]],
        paint: { 'line-color': '#ead5d7' },
      },
      {
        id: 'boundary_country_outline',
        type: 'line',
        source: 'carto',
        'source-layer': 'boundary',
        filter: ['all', ['==', 'admin_level', 2], ['==', 'maritime', 0]],
        paint: { 'line-color': '#f3efed', 'line-width': 8 },
      },
      {
        id: 'boundary_country_inner',
        type: 'line',
        source: 'carto',
        'source-layer': 'boundary',
        filter: ['all', ['==', 'admin_level', 2], ['==', 'maritime', 0]],
        paint: { 'line-color': '#ebd6d8' },
      },
      { id: 'place_villages', type: 'symbol', source: 'carto', 'source-layer': 'place', minzoom: 10, filter: ['all', ['==', 'class', 'village']] },
      { id: 'place_town', type: 'symbol', source: 'carto', 'source-layer': 'place', minzoom: 8, filter: ['all', ['==', 'class', 'town']] },
      { id: 'poi_park', type: 'symbol', source: 'carto', 'source-layer': 'poi', minzoom: 15 },
    ],
  } as StyleSpecification;
}

const byId = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as Record<string, unknown> & { paint?: Record<string, unknown>; minzoom?: number };

describe('basemapStyleFor', () => {
  it('uses CARTO Dark Matter for dark and CARTO Positron for light', () => {
    expect(basemapStyleFor('dark')).toContain('dark-matter-gl-style');
    expect(basemapStyleFor('light')).toContain('positron-gl-style');
  });

  it('keeps the building sources MapView extrudes and per-theme paint', () => {
    expect(BASEMAP_BUILDING_SOURCES).toContain('carto');
    expect(buildingPaint('dark')).toEqual({ color: '#2b2f35', opacity: 0.85 });
    expect(buildingPaint('light').color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('transformStyle', () => {
  it('leaves the dark style untouched', () => {
    const s = positron();
    expect(transformStyle(s, 'dark')).toBe(s);
  });

  it('deepens the sea to the palette water, neutralises borders and thins minor labels on light', () => {
    const before = positron();
    const snapshot = JSON.stringify(before);
    const s = transformStyle(before, 'light');
    expect(JSON.stringify(before)).toBe(snapshot); // pure
    expect(s.layers).toHaveLength(before.layers.length);
    expect(hexRgb(byId(s, 'water').paint!['fill-color'] as string)).toEqual(getMapPalette('light').basemap.water);
    expect(byId(s, 'water_shadow').paint!['fill-color']).toBe('transparent');
    expect(byId(s, 'boundary_country_inner').paint!['line-color']).not.toBe('#ebd6d8');
    expect(byId(s, 'boundary_country_outline').paint!['line-color']).toBe('#f3efed'); // wide soft casing kept
    expect(byId(s, 'boundary_state').paint!['line-color']).not.toBe('#ead5d7');
    expect(byId(s, 'place_villages').minzoom).toBe(11);
    expect(byId(s, 'place_town').minzoom).toBe(8);
    expect(byId(s, 'poi_park').minzoom).toBe(16);
    expect(byId(s, 'background')).toEqual(byId(before, 'background'));
  });

  it('falls back to the style as fetched on a malformed style', () => {
    const broken = { version: 8, sources: {} } as unknown as StyleSpecification;
    expect(() => transformStyle(broken, 'light')).toThrow();
    expect(safeTransformStyle(broken, 'light')).toBe(broken);
  });

  it('gives MapLibre a full swap with the transform hook', () => {
    const opts = basemapStyleOptions('light');
    expect(opts.diff).toBe(false);
    const s = opts.transformStyle!(undefined, positron());
    expect(byId(s, 'water').paint!['fill-color']).not.toBe('#d4dadc');
  });
});
