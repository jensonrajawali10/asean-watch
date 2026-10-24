import { describe, expect, it } from 'vitest';
import { riverFlowNeeded } from './layerNeeds';

describe('riverFlowNeeded', () => {
  it('is off on first paint (map mode, river layer off) and on with what shows river flow', () => {
    expect(riverFlowNeeded({ river: false }, null)).toBe(false);
    expect(riverFlowNeeded({ river: false }, 'haze')).toBe(false);
    expect(riverFlowNeeded({ river: false }, 'warnings')).toBe(false);
    expect(riverFlowNeeded({ river: true }, null)).toBe(true);
    for (const ws of ['water', 'situation', 'report'] as const) expect(riverFlowNeeded({ river: false }, ws)).toBe(true);
  });
});
