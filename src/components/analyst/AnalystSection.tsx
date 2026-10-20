// Frame for one analyst-workspace section (docs/UX_V3.md section 3). Dense, wordy on purpose: a title, a
// lede paragraph, the body, and a sources block that cites every feed the section used. Shared styles for
// tables, figures, bar charts and notes live in analyst.css (class prefix "an-").
import type { ReactNode } from 'react';
import './analyst.css';

export interface SectionSource {
  /** e.g. "NASA FIRMS VIIRS 375 m (NOAA-20)" */
  label: string;
  url?: string;
  /** ISO time the data were retrieved or issued. */
  retrievedAt?: string | null;
  /** e.g. "LIVE", "SNAPSHOT", "MODELLED", "OFFICIAL" */
  mode?: string;
  /** Licence or attribution text. */
  licence?: string;
}

export interface AnalystSectionProps {
  id: string;
  title: string;
  /** One or two sentences: what this section answers and how far to trust it. */
  lede?: ReactNode;
  /** Small right-aligned metadata in the header, e.g. a mode badge or "as of" time. */
  meta?: ReactNode;
  children: ReactNode;
  sources?: readonly SectionSource[];
}

export function AnalystSection({ id, title, lede, meta, children, sources }: AnalystSectionProps) {
  const headingId = `${id}-title`;
  return (
    <section className="an-section" id={id} aria-labelledby={headingId}>
      <header className="an-section__head">
        <h2 id={headingId} className="an-section__title">
          {title}
        </h2>
        {meta && <div className="an-section__meta">{meta}</div>}
      </header>
      {lede && <p className="an-lede">{lede}</p>}
      <div className="an-section__body">{children}</div>
      {sources && sources.length > 0 && (
        <footer className="an-sources">
          <h3 className="an-sources__title">Sources</h3>
          <ol>
            {sources.map((s, i) => (
              // Index in the key: two sources may share a label and a link (e.g. one agency's two feeds).
              <li key={`${i}|${s.label}|${s.url ?? ''}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.label}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  s.label
                )}
                {s.mode && <span className="an-tag">{s.mode}</span>}
                {s.retrievedAt && <span className="an-muted"> · {s.retrievedAt.replace('T', ' ').slice(0, 16)} UTC</span>}
                {s.licence && <span className="an-muted"> · {s.licence}</span>}
              </li>
            ))}
          </ol>
        </footer>
      )}
    </section>
  );
}

/** Sub-heading inside a section. */
export function AnalystSubhead({ children }: { children: ReactNode }) {
  return <h3 className="an-subhead">{children}</h3>;
}

/** A labelled key figure for a figures grid (wrap several in <div className="an-figures">). */
export function KeyFigure({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="an-figure">
      <span className="an-figure__label">{label}</span>
      <span className="an-figure__value">
        {value}
        {unit && <span className="an-figure__unit"> {unit}</span>}
      </span>
      {note && <span className="an-figure__note">{note}</span>}
    </div>
  );
}

export interface MiniBar {
  /** Short label under the bar, e.g. "Mon". */
  label: string;
  value: number;
  /** Full text for the tooltip and screen readers, e.g. "Mon 12 Oct: 312 hotspots". */
  title: string;
  highlight?: boolean;
}

/** A tiny accessible bar chart (daily counts and the like). Values are scaled to the largest bar. */
export function MiniBars({ bars, caption }: { bars: readonly MiniBar[]; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => (Number.isFinite(b.value) ? b.value : 0)));
  return (
    <figure className="an-bars">
      <div className="an-bars__plot" role="list" aria-label={caption}>
        {bars.map((b) => (
          <div className="an-bars__col" role="listitem" key={b.label + b.title} title={b.title} aria-label={b.title}>
            <span
              className={`an-bars__bar${b.highlight ? ' an-bars__bar--hi' : ''}`}
              style={{ height: `${Math.max(2, (Math.max(0, b.value) / max) * 100)}%` }}
            />
            <span className="an-bars__label" aria-hidden="true">
              {b.label}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="an-muted">{caption}</figcaption>
    </figure>
  );
}
