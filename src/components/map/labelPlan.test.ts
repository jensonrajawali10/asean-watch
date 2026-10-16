import { describe, expect, it } from 'vitest';
import { planRegionalLabels } from './labelPlan';
import type { PlanBadge, PlanCity } from './labelPlan';
import { cityMarkerRadius, cityZoomScale } from './cityMarkers';

const city = (id: string, x: number, y: number, pm25: number, force = false): PlanCity => ({ id, x, y, r: 8, name: id, value: String(pm25), pm25, force });
const badge = (id: string, x: number, y: number, priority: number): PlanBadge => ({ id, x, y, text: `${id} · ${priority} hotspots`, priority });

describe('planRegionalLabels', () => {
  it('labels the worst cities before fire badges', () => {
    // The badge's first choice (above its point) is where the worst city's label goes.
    const plan = planRegionalLabels([city('Worst', 100, 100, 700)], [badge('Prov', 150, 130, 5000)], { topCities: 1 });
    expect(plan.cities.get('Worst')).toBe('Worst  700');
    expect(plan.badges).toHaveLength(1);
    expect(plan.badges[0].side).not.toBe('above');
  });

  it('places badges before the other cities', () => {
    // A low city whose label would sit where the badge goes loses its label, not the badge.
    const plan = planRegionalLabels([city('Top', 900, 900, 700), city('Low', 60, 110, 20)], [badge('Prov', 160, 128, 5000)], { topCities: 1 });
    expect(plan.badges[0]).toMatchObject({ id: 'Prov', side: 'above' });
    expect(plan.cities.get('Low')).not.toBe('Low  20');
  });

  it('nudges a badge to another side, or hides it when no side is free', () => {
    const blocked = [{ x0: 0, y0: 0, x1: 1000, y1: 1000 }];
    expect(planRegionalLabels([], [badge('Prov', 500, 500, 10)], { obstacles: blocked }).badges).toEqual([]);
    const above = [{ x0: 400, y0: 400, x1: 600, y1: 495 }];
    expect(planRegionalLabels([], [badge('Prov', 500, 500, 10)], { obstacles: above }).badges[0].side).toBe('below');
  });

  it('shows at most maxBadges, largest first', () => {
    const plan = planRegionalLabels([], [badge('A', 100, 100, 1), badge('B', 100, 400, 9), badge('C', 600, 100, 5), badge('D', 600, 400, 7)], { maxBadges: 2 });
    expect(plan.badges.map((b) => b.id)).toEqual(['B', 'D']);
  });

  it('keeps obstacles (pins, volcano names) clear and always labels a selected city', () => {
    const pin = [{ x0: 105, y0: 90, x1: 400, y1: 110 }];
    const plan = planRegionalLabels([city('A', 100, 100, 50), city('B', 100, 300, 40, true)], [], { obstacles: pin });
    expect(plan.cities.has('A')).toBe(false);
    expect(plan.cities.get('B')).toBe('B  40');
  });

  it('falls back to the value alone where the name does not fit', () => {
    const plan = planRegionalLabels([city('Longname', 100, 100, 300), city('X', 160, 100, 10)], [], { topCities: 5 });
    expect(plan.cities.get('Longname')).toBe('300');
  });
});

describe('city circle scale', () => {
  it('shrinks circles at the regional zoom and grows them back closer in', () => {
    expect(cityZoomScale(3)).toBeLessThan(cityZoomScale(5));
    expect(cityZoomScale(7)).toBe(1);
    expect(cityMarkerRadius(400, 7)).toBeGreaterThan(cityMarkerRadius(400, 3));
    expect(cityMarkerRadius(400, 7, 'city', true)).toBe(cityMarkerRadius(400, 7) + 2);
  });
});
