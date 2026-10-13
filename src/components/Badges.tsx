// Text-first badges. Colour is secondary: every badge carries its meaning in words.
import type { ReactNode } from 'react';
import type { DataMode, ReviewState } from '../types';
import { REVIEW_LABELS } from '../lib/reviewRules';
import { modeLabel, safeHttpUrl, shortSourceName } from './format';

export function StateBadge({
  state,
  label,
  size = 'md',
}: {
  state: ReviewState;
  label?: string;
  size?: 'md' | 'lg';
}) {
  const known = state in REVIEW_LABELS;
  const text = label ?? (known ? REVIEW_LABELS[state] : String(state));
  return (
    <span className={`badge badge-state badge-state--${known ? state : 'monitoring'} badge--${size}`}>
      <span className="badge-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: DataMode }) {
  return (
    <span className={`badge badge-mode badge-mode--${mode}`} title="Data mode">
      {modeLabel(mode)}
    </span>
  );
}

export function CountedPill({ counted }: { counted: boolean }) {
  return (
    <span className={`pill ${counted ? 'pill--counted' : 'pill--not-counted'}`}>
      {counted ? 'Counted' : 'Not counted'}
    </span>
  );
}

/** External link that always opens in a new tab and says so to assistive tech. */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={safe} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true" className="ext-mark">
        {' '}
        ↗
      </span>
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/** Source badge: short "Modelled on …" name and an external link; the full name is in the title. */
export function SourceBadge({ name, url }: { name: string; url: string }) {
  const full = name?.trim() ? name.trim() : 'Unnamed source';
  const label = shortSourceName(full);
  if (!safeHttpUrl(url)) {
    return (
      <span className="source-badge source-badge--nolink" title={full}>
        {label} (no link)
      </span>
    );
  }
  return (
    <a className="source-badge" href={safeHttpUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer" title={full}>
      {label}
      <span aria-hidden="true"> ↗</span>
      <span className="visually-hidden"> (source, opens in a new tab)</span>
    </a>
  );
}

/** NEA context data mode. Calm outline styles: never the red alarm colour or the simulated purple. */
export function NeaModeBadge({ mode }: { mode: 'live' | 'historical' }) {
  return mode === 'live' ? (
    <span className="badge badge-nea badge-nea--live">
      <span className="badge-dot" aria-hidden="true" />
      LIVE
    </span>
  ) : (
    <span className="badge badge-nea badge-nea--historical">HISTORICAL SNAPSHOT</span>
  );
}
