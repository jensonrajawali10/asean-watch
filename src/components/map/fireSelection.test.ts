import { describe, expect, it } from 'vitest';
import { fireCells, loadFireSnapshot, regionalBadges } from '../../lib/fires';
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

  it('resolves a cluster id from the snapshot (a pasted link); without a grid in the snapshot, a cell only from its pick', () => {
    expect(resolveFirePick(snap, '24h-1', null)).toEqual({ kind: 'fire-cluster', cluster });
    const cell: FirePick = { kind: 'fire-cell', cell: { id: '0.25:9' } as never, recent: false };
    expect(resolveFirePick(snap, 'cell-7d-0.25:9', cell)).toBe(cell);
    expect(resolveFirePick(snap, 'cell-7d-0.25:9', null)).toBeNull();
    expect(resolveFirePick(null, '24h-1', null)).toBeNull();
    expect(resolveFirePick(snap, 'nope', null)).toBeNull();
  });
});

describe('restoring a fire selection after a reload or from a shared link', () => {
  const real = loadFireSnapshot()!;
  it('resolves a province badge id from the snapshot, the same badge the map drew', () => {
    const badge = regionalBadges(real, '24h', 8)[0];
    const pick = resolveFirePick(real, `region-${badge.id}`, null);
    expect(pick).toEqual({ kind: 'fire-region', badge });
    expect(fireSelectionId(pick!)).toBe(`region-${badge.id}`);
  });
  it('resolves a grid cell id from the snapshot, recent and older', () => {
    const recent = fireCells(real, '24h')[0];
    expect(resolveFirePick(real, `cell-24h-${recent.id}`, null)).toEqual({ kind: 'fire-cell', cell: recent, recent: true });
    const older = fireCells(real, 'before24h')[0];
    expect(resolveFirePick(real, `cell-7d-${older.id}`, null)).toEqual({ kind: 'fire-cell', cell: older, recent: false });
  });
  it('returns null for a badge or cell the snapshot does not have', () => {
    expect(resolveFirePick(real, 'region-badge:XXX:Nowhere', null)).toBeNull();
    expect(resolveFirePick(real, 'cell-24h-0.25:-1', null)).toBeNull();
  });
});
