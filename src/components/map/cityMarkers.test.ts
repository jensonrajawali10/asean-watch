import { describe, expect, it } from 'vitest';
import { cityRadiusPx, placeCityLabels, pulseRing, shortCityName, valueText, worstId } from './cityMarkers';

describe('cityRadiusPx', () => {
  it('grows with the square root of PM2.5 between 6 and 26 px', () => {
    expect(cityRadiusPx(0)).toBe(6);
    expect(cityRadiusPx(Number.NaN)).toBe(6);
    expect(cityRadiusPx(16)).toBeCloseTo(10.8, 5);
    expect(cityRadiusPx(100)).toBeCloseTo(19.5, 5);
    expect(cityRadiusPx(5000)).toBe(26);
    expect(cityRadiusPx(400)).toBeGreaterThan(cityRadiusPx(100));
  });
});

describe('worstId', () => {
  it('picks the highest finite value and ignores missing ones', () => {
    expect(worstId([{ id: 'a', pm25: 12 }, { id: 'b', pm25: Number.NaN }, { id: 'c', pm25: 600 }])).toBe('c');
    expect(worstId([])).toBeNull();
    expect(worstId([{ id: 'a', pm25: Number.NaN }])).toBeNull();
  });
});

describe('names and values', () => {
  it('shortens names and groups thousands', () => {
    expect(shortCityName('Dumai (Riau peatlands)')).toBe('Dumai');
    expect(shortCityName('Singapore')).toBe('Singapore');
    expect(valueText(1204.4)).toBe('1,204');
    expect(valueText(Number.NaN)).toBe('—');
  });
});

describe('placeCityLabels', () => {
  const c = (id: string, x: number, y: number, priority: number, force = false) => ({ id, x, y, r: 10, name: id.toUpperCase(), value: String(priority), priority, force });

  it('labels the worst first and drops to the value when the full label collides', () => {
    const out = placeCityLabels([c('a', 100, 100, 50), c('b', 100, 108, 600)]);
    expect(out[0]).toEqual({ id: 'b', text: 'B  600', kind: 'full' });
    expect(out.find((l) => l.id === 'a')).toBeUndefined();
  });

  it('keeps far-apart labels in full', () => {
    const out = placeCityLabels([c('a', 100, 100, 50), c('b', 100, 300, 600)]);
    expect(out.map((l) => l.kind)).toEqual(['full', 'full']);
  });

  it('always labels a forced (selected) city in full', () => {
    const out = placeCityLabels([c('a', 100, 100, 50, true), c('b', 100, 104, 600)]);
    expect(out[0]).toEqual({ id: 'a', text: 'A  50', kind: 'full' });
  });

  it('skips labels outside the viewport', () => {
    expect(placeCityLabels([c('a', 790, 100, 50)], { viewport: { w: 800, h: 600 } })).toEqual([]);
  });

  it('is deterministic', () => {
    const items = [c('a', 10, 10, 5), c('b', 30, 12, 5), c('c', 60, 9, 5)];
    expect(placeCityLabels(items)).toEqual(placeCityLabels([...items].reverse()));
  });
});

describe('pulseRing', () => {
  it('grows and fades over one period, then repeats', () => {
    const start = pulseRing(10, 0);
    const mid = pulseRing(10, 1200);
    expect(start).toEqual({ radius: 13, alpha: 180 });
    expect(mid.radius).toBeGreaterThan(start.radius);
    expect(mid.alpha).toBeLessThan(start.alpha);
    expect(pulseRing(10, 2400)).toEqual(start);
  });
});
