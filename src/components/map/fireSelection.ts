// A fire pick (from the fires module's map layers) as a selection id for the URL hash, and back.
// Clusters keep their own id ("24h-1"), so #sel=fire:24h-1 links to a cluster. Grid cells ("cell-24h-0.25:812")
// and province/state/country badges ("region-badge:IDN:Riau") get prefixed ids; they resolve from the pick
// that made them, else from the same snapshot (a reload or a shared link), else not at all (a newer snapshot
// that no longer has that cell or badge): the card then says it is not in the current snapshot.
import { clusterById, fireCells, regionalBadges } from '../../lib/fires';
import type { FireCell, FireSnapshot } from '../../lib/fires';
import type { FirePick } from './fireLayers';

/** What resolveFirePick reads from a snapshot; cells and badges need the grid and the rollups. */
export type FireSelectionSnapshot = Pick<FireSnapshot, 'clusters24h' | 'clusters7d'> &
  Partial<Pick<FireSnapshot, 'frame' | 'gridPeriods' | 'countries' | 'regions'>>;

export function fireSelectionId(pick: FirePick): string {
  switch (pick.kind) {
    case 'fire-cluster':
      return pick.cluster.id;
    case 'fire-cell':
      return `cell-${pick.recent ? '24h' : '7d'}-${pick.cell.id}`;
    case 'fire-region':
      return `region-${pick.badge.id}`;
  }
}

const cellCache = new WeakMap<object, { recent: FireCell[]; older: FireCell[] }>();

/** A grid cell from the snapshot by its selection id, or null (no grid in the snapshot, or no such cell). */
function cellFromSnapshot(s: FireSelectionSnapshot, id: string): FirePick | null {
  const m = /^cell-(24h|7d)-(.+)$/.exec(id);
  if (!m || !s.frame || !s.gridPeriods) return null;
  const grid = { frame: s.frame, gridPeriods: s.gridPeriods };
  let sets = cellCache.get(s);
  if (!sets) {
    sets = { recent: fireCells(grid, '24h'), older: fireCells(grid, 'before24h') };
    cellCache.set(s, sets);
  }
  const recent = m[1] === '24h';
  const cell = (recent ? sets.recent : sets.older).find((c) => c.id === m[2]);
  return cell ? { kind: 'fire-cell', cell, recent } : null;
}

/** A province, state or country badge from the snapshot by its selection id, or null. */
function regionFromSnapshot(s: FireSelectionSnapshot, id: string): FirePick | null {
  if (!id.startsWith('region-') || !s.countries || !s.regions) return null;
  const badgeId = id.slice('region-'.length);
  // The same badges the map draws (24 h window); no cap, so a badge the map showed is always found.
  const badge = regionalBadges({ countries: s.countries, regions: s.regions }, '24h', Number.POSITIVE_INFINITY).find((b) => b.id === badgeId);
  return badge ? { kind: 'fire-region', badge } : null;
}

/** The pick for a selection id: the last pick when it made this id, else from the snapshot; null otherwise. */
export function resolveFirePick(snapshot: FireSelectionSnapshot | null, id: string, last: FirePick | null): FirePick | null {
  if (last && fireSelectionId(last) === id) return last;
  if (!snapshot) return null;
  const cluster = clusterById(snapshot, id);
  if (cluster) return { kind: 'fire-cluster', cluster };
  return cellFromSnapshot(snapshot, id) ?? regionFromSnapshot(snapshot, id);
}

/** Where the map should look for a fire pick. */
export function firePoint(pick: FirePick): { lat: number; lon: number } {
  switch (pick.kind) {
    case 'fire-cluster':
      return { lat: pick.cluster.lat, lon: pick.cluster.lon };
    case 'fire-cell':
      return { lat: pick.cell.lat, lon: pick.cell.lon };
    case 'fire-region':
      return { lat: pick.badge.lat, lon: pick.badge.lon };
  }
}
