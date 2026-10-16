// Text-first badges. Colour is secondary: every badge carries its meaning in words.
// Families (docs/DESIGN.md section 3): review state, data mode, rule treatment, official (reserved),
// impact estimate. They differ in shape, case and wording, not only in colour.
import type { ReactNode } from 'react';
import type { DataMode, OfficialWarning, ReviewState } from '../types';
import { REVIEW_LABELS } from '../lib/reviewRules';
import { endedLabel } from '../lib/warningsView';
import { formatUtc, modeLabel, safeHttpUrl } from './format';

export function StateBadge({
  state,
  label,
  size = 'md',
}: {
  state: ReviewState;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
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

/**
 * Data mode. HISTORICAL SNAPSHOT and LIVE always carry a time when one is given; MODELLED means
 * context from a model (never evidence). Unknown modes render their name in uppercase.
 */
export function ModeBadge({ mode, time, title }: { mode: DataMode | string; time?: string | null; title?: string }) {
  const m = String(mode);
  const text = m === 'historical' ? 'HISTORICAL SNAPSHOT' : modeLabel(m);
  return (
    <span className={`badge badge-mode badge-mode--${m}`} title={title ?? 'Data mode'}>
      {m === 'live' && <span className="badge-dot" aria-hidden="true" />}
      {text}
      {time && (
        <>
          {' '}
          <time className="badge-time" dateTime={time}>
            {formatUtc(time)}
          </time>
        </>
      )}
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

/** Source badge: the real source name and an external link to its public description page. */
export function SourceBadge({ name, url }: { name: string; url: string }) {
  const full = name?.trim() ? name.trim() : 'Unnamed source';
  if (!safeHttpUrl(url)) {
    return (
      <span className="source-badge source-badge--nolink" title={full}>
        {full} (no link)
      </span>
    );
  }
  return (
    <a className="source-badge" href={safeHttpUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer" title={full}>
      {full}
      <span aria-hidden="true"> ↗</span>
      <span className="visually-hidden"> (source, opens in a new tab)</span>
    </a>
  );
}

/** NEA context data mode. Calm outline styles: never the alarm colour, never the modelled violet. */
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

// ---------------------------------------------------------------------------
// Official warnings: reserved styles. Never used for our own review states.

/** "OFFICIAL · <issuer>" eyebrow, or the aggregator form for impact estimates. */
export function OfficialTag({ issuer, authority }: { issuer: string; authority: 'official' | 'aggregator' }) {
  return authority === 'aggregator' ? (
    <span className="official-tag official-tag--estimate">
      <span className="official-word">Impact estimate</span> · <span className="official-issuer">{issuer}</span>{' '}
      <span className="official-issuer-note">(aggregator, not a warning)</span>
    </span>
  ) : (
    <span className="official-tag">
      <span className="official-word">OFFICIAL</span> · <span className="official-issuer">{issuer}</span>
    </span>
  );
}

/** The issuer's verbatim level in a square chip; a reviewed English gloss follows in plain text. */
export function OfficialLevelChip({
  level,
  gloss,
  ended,
  authority = 'official',
}: {
  level: string;
  gloss?: string | null;
  ended?: boolean;
  authority?: 'official' | 'aggregator';
}) {
  const text = level?.trim() || 'Level not stated';
  return (
    <span className="official-level">
      <span
        className={`official-chip${ended ? ' official-chip--ended' : ''}${authority === 'aggregator' ? ' official-chip--estimate' : ''}`}
        lang={undefined}
      >
        {text}
      </span>
      {gloss?.trim() && <span className="official-gloss">{gloss.trim()}</span>}
    </span>
  );
}

/**
 * ENDED when the issuer ended or cancelled the message before its expiry; EXPIRED with the issuer's
 * expiry time only once that has passed on the nowMs clock (endedLabel). Nothing while it is active.
 */
export function EndedChip({
  warning,
  nowMs,
}: {
  warning: Pick<OfficialWarning, 'ended' | 'expiresAt' | 'retrievedAt'>;
  nowMs: number;
}) {
  const label = endedLabel(warning, nowMs);
  if (!label) return null;
  return label.text === 'EXPIRED' ? (
    <span className="official-chip official-chip--ended">
      EXPIRED <time dateTime={label.at}>{formatUtc(label.at)}</time>
    </span>
  ) : (
    <span className="official-chip official-chip--ended">ENDED</span>
  );
}
