// Which on-demand data a view needs (docs/night/perf.md change 3): layer-gated data loads with the layer or
// workspace section that shows it, not on first paint. Kept out of App.tsx so it is testable on its own.
import type { SectionId } from '../shell/workspace';

/**
 * GloFAS river flow: the river layer, the Tsunami & floods section, and the situation report and report
 * composer that cite it (they say "not loaded" until it arrives). Off on first paint: the layer is off by
 * default and the map's first view does not use it.
 */
export function riverFlowNeeded(layers: { river: boolean }, ws: SectionId | null): boolean {
  return layers.river || ws === 'water' || ws === 'situation' || ws === 'report';
}
