// Citation helpers shared by the analyst sections (kept out of reportParts.tsx so that file only exports
// components, which fast refresh needs).
import type { Citation } from '../../lib/situation';
import type { SectionSource } from './AnalystSection';

/** Citation id → number (1-based), in the order of the list. */
export function citationNumbers(citations: readonly Citation[]): Map<string, number> {
  return new Map(citations.map((c, i) => [c.id, i + 1]));
}

/** Citations as AnalystSection sources (the footer's numbered list matches citationNumbers). */
export function citationsToSources(citations: readonly Citation[]): SectionSource[] {
  return citations.map((c) => ({
    label: c.label,
    url: c.url ?? undefined,
    retrievedAt: c.time,
    mode: c.mode === 'LINK' ? 'LINK ONLY' : c.mode === 'RECORDED' ? 'RECORDED COPY' : `${c.basis} · ${c.mode}`,
    licence: c.licence ?? undefined,
  }));
}
