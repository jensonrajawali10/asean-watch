// Workspace section 1, "Situation" (docs/UX_V3.md section 3): the deterministic situation report from
// src/lib/situation.ts, with the headline and freshness chip, a "what changed" note, the key figures, one
// part per hazard, and data freshness and gaps.
// Every figure carries MODELLED / MEASURED / OFFICIAL in words, its time and a numbered source.
import { useMemo } from 'react';
import { situationReport } from '../../lib/situation';
import type { ReportSection, SituationInput, SituationReport } from '../../lib/situation';
import { AnalystSection, AnalystSubhead } from './AnalystSection';
import { citationNumbers, citationsToSources } from './citations';
import { BasisTag, FigureGrid, FreshnessChip, ReportBlockView } from './reportParts';

/** Workspace sections a part of the report can link to (the shell's SectionId values). */
export type SituationLinkTarget = 'haze' | 'fires' | 'volcanoes' | 'warnings' | 'water' | 'report' | 'sources';

const LINK_FOR: Partial<Record<ReportSection['id'], { target: SituationLinkTarget; label: string }>> = {
  haze: { target: 'haze', label: 'Open Haze & air' },
  transport: { target: 'haze', label: 'Open Haze & air' },
  fires: { target: 'fires', label: 'Open Fires' },
  volcanoes: { target: 'volcanoes', label: 'Open Volcanoes' },
  warnings: { target: 'warnings', label: 'Open Official warnings' },
  water: { target: 'water', label: 'Open Tsunami & floods' },
  freshness: { target: 'sources', label: 'Open Sources & methods' },
};

export interface SituationSectionProps {
  /** Everything App already holds (see SituationInput). Memoise it in App so the report is not rebuilt each render. */
  input: SituationInput;
  /** A report already built from the same input (optional; built here otherwise). */
  report?: SituationReport | null;
  /** Open another workspace section (the shell's section setter). */
  onOpenSection?: (section: SituationLinkTarget) => void;
}

export default function SituationSection({ input, report, onOpenSection }: SituationSectionProps) {
  const r = useMemo(() => report ?? situationReport(input), [report, input]);
  const numbers = useMemo(() => citationNumbers(r.citations), [r.citations]);
  const parts = r.sections.filter((s) => s.id !== 'overview' && s.id !== 'freshness');
  const overview = r.sections.find((s) => s.id === 'overview');
  const freshness = r.sections.find((s) => s.id === 'freshness');

  return (
    <AnalystSection
      id="ws-situation"
      title="Overview"
      meta={<FreshnessChip freshness={r.headline.freshness} chip={r.headline.chip} age={r.headline.age} />}
      lede={
        <>
          Generated from the loaded data by fixed rules, not written by hand or by AI. Modelled values are context, measured
          values are observations, and official messages are relayed verbatim. Every figure gives its source number and time;
          the sources are listed at the end.
        </>
      }
      sources={citationsToSources(r.citations)}
    >
      <div className="anx-headline">
        <p className="anx-headline__text">{r.headline.text}</p>
      </div>

      {r.whatChanged.length > 0 && (
        <section className="anx-changed" aria-label="What changed">
          <h3>What changed</h3>
          <ul>
            {r.whatChanged.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <AnalystSubhead>Key figures</AnalystSubhead>
      <FigureGrid figures={r.keyFigures} numbers={numbers} />
      {overview?.blocks
        .filter((b) => b.kind === 'caveat')
        .map((b, i) => (
          <ReportBlockView key={i} block={b} numbers={numbers} />
        ))}

      {parts.map((s) => {
        const link = LINK_FOR[s.id];
        const repeated = s.blocks.some((b) => b.kind === 'paragraph' && b.text.startsWith(s.summary));
        return (
          <section key={s.id} aria-labelledby={`ws-situation-${s.id}`}>
            <h3 id={`ws-situation-${s.id}`} className="anx-block-title">
              {s.title} <BasisTag basis={s.basis} />
            </h3>
            {!repeated && <p>{s.summary}</p>}
            <FigureGrid figures={s.figures.filter((f) => !r.keyFigures.includes(f))} numbers={numbers} />
            {s.blocks.map((b, i) => (
              <ReportBlockView key={i} block={b} numbers={numbers} />
            ))}
            {link && onOpenSection && (
              <p>
                <button type="button" className="an-row-btn" onClick={() => onOpenSection(link.target)}>
                  {link.label} →
                </button>
              </p>
            )}
          </section>
        );
      })}

      {freshness && (
        <section aria-labelledby="ws-situation-freshness">
          <h3 id="ws-situation-freshness" className="anx-block-title">
            {freshness.title}
          </h3>
          {freshness.blocks.map((b, i) => (
            <ReportBlockView key={i} block={b} numbers={numbers} />
          ))}
        </section>
      )}

      <p className="an-note">{r.disclaimer}</p>
      {onOpenSection && (
        <p>
          <button type="button" className="an-row-btn" onClick={() => onOpenSection('report')}>
            Compose a report from these figures →
          </button>
        </p>
      )}
    </AnalystSection>
  );
}
