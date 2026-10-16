import { describe, expect, it } from 'vitest';
import type { FireCluster } from '../../lib/fires';
import type { FirePick } from './fireLayers';
import { fireSelectionId, resolveFirePick } from './fireSelection';

const cluster = { id: '24h-1', window: '24h' } as unknown as FireCluster;
const snap = { clusters24h: [cluster], clusters7d: [] as FireCluster[] };

describe('fire selection ids', () => {
  it('uses the cluster id for clusters and prefixed ids for cells and regions', () => {
    expect(fireSelectionId({ kind: 'fire-cluster', cluster })).toBe('24h-1');
    expect(fireSelectionId({ kind: 'fire-cell', cell: { id: '0.25:812' } as never, recent: true })).toBe('cell-24h-0.25:812');
    expect(fireSelectionId({ kind: 'fire-region', badge: { id: 'IDN-62' } as never })).toBe('region-IDN-62');
  });

  it('resolves a cluster id from the snapshot (a pasted link) and a cell only from the pick that made it', () => {
    expect(resolveFirePick(snap, '24h-1', null)).toEqual({ kind: 'fire-cluster', cluster });
    const cell: FirePick = { kind: 'fire-cell', cell: { id: '0.25:9' } as never, recent: false };
    expect(resolveFirePick(snap, 'cell-7d-0.25:9', cell)).toBe(cell);
    expect(resolveFirePick(snap, 'cell-7d-0.25:9', null)).toBeNull();
    expect(resolveFirePick(null, '24h-1', null)).toBeNull();
    expect(resolveFirePick(snap, 'nope', null)).toBeNull();
  });
});
