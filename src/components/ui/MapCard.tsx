// The one card anatomy for map mode (docs/UX_V3.md section 2): header (icon, title, data-kind label),
// up to three big facts, one plain sentence, an optional slot, and a footer with the workspace link and the
// source. Calm and short on purpose; depth lives in the analyst workspace.
import type { ReactNode } from 'react';
import './MapCard.css';

/** What kind of information the card carries. The label text carries the meaning; colour is secondary. */
export type DataKind = 'measured' | 'modelled' | 'official' | 'scenario' | 'aggregator' | 'catalog';

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  measured: 'MEASURED',
  modelled: 'MODELLED',
  official: 'OFFICIAL',
  scenario: 'MODELLED SCENARIO',
  aggregator: 'ESTIMATE',
  catalog: 'CATALOG',
};

/** Tone of a fact value: an air-quality band, the reserved official colour, or plain ink. */
export type FactTone = 'default' | 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'official' | 'muted';

export interface MapCardFact {
  label: string;
  value: string;
  unit?: string;
  tone?: FactTone;
  /** Extra line under the value, e.g. "at 15:00 tomorrow". */
  note?: string;
}

export interface MapCardAction {
  label: string;
  onClick: () => void;
  /** Accessible description when the label alone is ambiguous. */
  title?: string;
}

export interface MapCardProps {
  /** Small decorative glyph or SVG before the title. */
  icon?: ReactNode;
  /** Above the title, e.g. "Volcano · Central Java". */
  eyebrow?: string;
  title: string;
  kind: DataKind;
  /** Overrides the default kind label, e.g. "OFFICIAL · MAGMA". */
  kindLabel?: string;
  facts?: readonly MapCardFact[];
  /** One plain-language sentence of meaning, shown first (before the numbers) for first-time visitors. */
  sentence?: ReactNode;
  /** Optional extra content (a button row, a tiny chart). Keep it short. */
  children?: ReactNode;
  /** Primary action, usually "Open in workspace". */
  action?: MapCardAction;
  /** A second action, e.g. "Play ash scenario". Rendered as the prominent button when present. */
  primaryAction?: MapCardAction;
  /** Source line in small text, e.g. "CAMS via Open-Meteo · run 14 Oct 15:58 UTC". */
  source?: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function MapCard({
  icon,
  eyebrow,
  title,
  kind,
  kindLabel,
  facts,
  sentence,
  children,
  action,
  primaryAction,
  source,
  onClose,
  className,
}: MapCardProps) {
  return (
    <section className={`mcard mcard--${kind}${className ? ` ${className}` : ''}`} aria-label={title}>
      <header className="mcard__head">
        {icon && (
          <span className="mcard__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="mcard__titles">
          {eyebrow && <p className="mcard__eyebrow">{eyebrow}</p>}
          <h3 className="mcard__title">{title}</h3>
        </div>
        <span className={`mcard__kind mcard__kind--${kind}`}>{kindLabel ?? DATA_KIND_LABEL[kind]}</span>
        {onClose && (
          <button type="button" className="mcard__close" onClick={onClose} aria-label={`Close ${title}`}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </header>
      {sentence && <p className="mcard__sentence">{sentence}</p>}
      {facts && facts.length > 0 && (
        <dl className={`mcard__facts mcard__facts--${Math.min(facts.length, 3)}`}>
          {facts.slice(0, 3).map((f) => (
            <div className="mcard__fact" key={f.label}>
              <dt>{f.label}</dt>
              <dd className={`mcard__value mcard__value--${f.tone ?? 'default'}`}>
                {f.value}
                {f.unit && <span className="mcard__unit"> {f.unit}</span>}
              </dd>
              {f.note && <dd className="mcard__note">{f.note}</dd>}
            </div>
          ))}
        </dl>
      )}
      {children && <div className="mcard__slot">{children}</div>}
      {(primaryAction || action || source) && (
        <footer className="mcard__foot">
          {primaryAction && (
            <button type="button" className="mcard__btn mcard__btn--primary" onClick={primaryAction.onClick} title={primaryAction.title}>
              {primaryAction.label}
            </button>
          )}
          {action && (
            <button type="button" className="mcard__btn mcard__btn--link" onClick={action.onClick} title={action.title}>
              {action.label} <span aria-hidden="true">→</span>
            </button>
          )}
          {source && <p className="mcard__source">{source}</p>}
        </footer>
      )}
    </section>
  );
}
