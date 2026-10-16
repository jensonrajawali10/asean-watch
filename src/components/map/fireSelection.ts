// A fire pick (from the fires module's map layers) as a selection id for the URL hash, and back.
// Clusters keep their own id ("24h-1"), so #sel=fire:24h-1 links to a cluster; grid cells and region badges
// get prefixed ids that only resolve against the pick that made them (they are not stable across snapshots).
import { clusterById } from '../../lib/fires';
import type { FireSnapshot } from '../../lib/fires';
import type { FirePick } from './fireLayers';

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

/** The pick for a selection id: the last pick when it made this id, else a cluster from the snapshot; null otherwise. */
export function resolveFirePick(snapshot: Pick<FireSnapshot, 'clusters24h' | 'clusters7d'> | null, id: string, last: FirePick | null): FirePick | null {
  if (last && fireSelectionId(last) === id) return last;
  if (!snapshot) return null;
  const cluster = clusterById(snapshot, id);
  return cluster ? { kind: 'fire-cluster', cluster } : null;
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
