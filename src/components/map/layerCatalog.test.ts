import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, LAYER_CATALOG, LAYER_GROUPS, MAP_CHIPS, layersInGroup } from './layerCatalog';

describe('layer catalog', () => {
  it('has at most six map chips, each with a short label', () => {
    expect(MAP_CHIPS.length).toBeLessThanOrEqual(6);
    expect(MAP_CHIPS.map((c) => c.chipLabel)).toEqual(['Haze', 'Wind', 'Fires', 'Volcanoes', 'Warnings', 'Clouds']);
  });

  it('has unique keys, an explanation for every layer and a default for every key', () => {
    const keys = LAYER_CATALOG.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of LAYER_CATALOG) {
      expect(l.explanation.length).toBeGreaterThan(30);
      expect(typeof DEFAULT_LAYERS[l.key]).toBe('boolean');
    }
  });

  it('labels every modelled layer as such and never calls absence an all-clear', () => {
    for (const l of LAYER_CATALOG) {
      if (l.kind === 'modelled') expect(/model/i.test(l.label) || /model/i.test(l.explanation)).toBe(true);
      expect(/all[- ]clear/i.test(l.explanation)).toBe(false);
    }
  });

  it('puts every layer in a listed group', () => {
    const grouped = LAYER_GROUPS.flatMap((g) => layersInGroup(g));
    expect(grouped.length).toBe(LAYER_CATALOG.length);
  });

  it('starts calm: no imagery, quakes, tide or river on by default', () => {
    expect(DEFAULT_LAYERS.satIr).toBe(false);
    expect(DEFAULT_LAYERS.quakes).toBe(false);
    expect(DEFAULT_LAYERS.tide).toBe(false);
    expect(DEFAULT_LAYERS.river).toBe(false);
    expect(DEFAULT_LAYERS.gauges).toBe(false);
    expect(DEFAULT_LAYERS.haze).toBe(true);
    expect(DEFAULT_LAYERS.warnings).toBe(true);
  });
});
