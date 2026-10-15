// Small shared pieces for the analyst sections: basis tags (MODELLED / MEASURED / OFFICIAL / ESTIMATE, in
// words, never colour alone), the freshness chip, citation marks that match the numbered sources footer,
// a figure grid with source and time, and a renderer for the report blocks built by src/lib/situation.ts.
import type { ReactNode } from 'react';
import type { Basis, Headline, ReportBlock, ReportFigure } from '../../lib/situation';
import { utcStamp } from '../../lib/situation';
import './workspaceSections.css';

const BASIS_TITLE: Record<Basis, string> = {
  MODELLED: 'Forecast-model output: context, not an observation',
  MEASURED: 'Measured by stations or satellites',
  OFFICIAL: 'Relayed verbatim from the issuing agency',
  ESTIMATE: "An aggregator's impact estimate, not an official warning",
};

export function BasisTag({ basis }: { basis: Basis | 'MIXED' }) {
  if (basis === 'MIXED') return null;
  return (
    <span className={`anx-basis anx-basis--${basis.toLowerCase()}`} title={BASIS_TITLE[basis]}>
      {basis}
    </span>
  );
}

/** LIVE / SNAPSHOT <time> / NO MODEL DATA, from a headline (or any mode and time). */
export function FreshnessChip({ freshness, chip }: Pick<Headline, 'freshness' | 'chip'>) {
  const cls = freshness === 'LIVE' ? 'anx-chip--live' : freshness === 'SNAPSHOT' ? 'anx-chip--snapshot' : 'anx-chip--unavailable';
  const title =
    freshness === 'LIVE'
      ? 'Model run fetched in this session'
      : freshness === 'SNAPSHOT'
        ? 'Bundled snapshot: not current conditions'
        : 'No air-quality model data loaded';
  return (
    <span className={`anx-chip ${cls}`} title={title}>
      {chip}
    </span>
  );
}

/** "[1, 3]" for the cited ids that have a number. */
export function CiteMarks({ ids, numbers }: { ids: readonly string[]; numbers: ReadonlyMap<string, number> }) {
  const nums = [...new Set(ids.map((id) => numbers.get(id)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  if (nums.length === 0) return null;
  return (
    <span className="anx-cite" title="Numbered sources at the end of this section">
      [{nums.join(', ')}]
    </span>
  );
}

export function FigureGrid({ figures, numbers }: { figures: readonly ReportFigure[]; numbers: ReadonlyMap<string, number> }) {
  if (figures.length === 0) return null;
  return (
    <div className="an-figures">
      {figures.map((f) => (
        <div className="an-figure" key={`${f.label}|${f.cite}`}>
          <span className="an-figure__label">{f.label}</span>
          <span className="an-figure__value">
            {f.value}
            {f.unit && <span className="an-figure__unit"> {f.unit}</span>}
          </span>
          {f.note && <span className="an-figure__note">{f.note}</span>}
          <span className="anx-figure-meta">
            <BasisTag basis={f.basis} />
            {f.time && <span>{utcStamp(f.time)}</span>}
            <CiteMarks ids={[f.cite]} numbers={numbers} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReportBlockView({ block, numbers }: { block: ReportBlock; numbers: ReadonlyMap<string, number> }): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          {block.text} <CiteMarks ids={block.cites} numbers={numbers} />
        </p>
      );
    case 'bullets':
      return (
        <>
          <ul className={`anx-list${block.official ? ' anx-list--official' : ''}`}>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          {block.cites.length > 0 && (
            <p className="an-muted">
              Sources: <CiteMarks ids={block.cites} numbers={numbers} />
            </p>
          )}
        </>
      );
    case 'table':
      return (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption>
              {block.caption} <CiteMarks ids={block.cites} numbers={numbers} />
            </caption>
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={c} scope="col" className={block.numeric?.[i] ? 'an-num' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.columns.map((c, i) => (
                    <td key={c} className={block.numeric?.[i] ? 'an-num' : undefined}>
                      {row[i] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'caveat':
      return <p className="an-note">{block.text}</p>;
    default:
      return null;
  }
}

/** An external link that always opens in a new tab and says so to screen readers. */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}
