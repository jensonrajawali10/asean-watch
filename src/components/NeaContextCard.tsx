// One compact NEA Singapore context card. Context, not evidence: it never changes the review state.
import type { DriftAssessment, NeaContext } from '../types';
import { ExternalLink, NeaModeBadge } from './Badges';
import { formatUtc } from './format';

export interface NeaContextCardProps {
  /** True while loadNeaContext() is still running and the incident is near Singapore. */
  loading: boolean;
  nea: NeaContext | null;
  drift: DriftAssessment | null;
  fellBack: boolean;
  /** Non-fatal note from loadNeaContext (for example, live PSI unavailable). */
  error: string | null;
}

/** "24-h PSI 121–172, Unhealthy", or null when there is no usable PSI. */
function psiSummary(nea: NeaContext): string | null {
  const haze = nea.haze;
  const values = haze ? Object.values(haze.psi24h ?? {}).filter((v) => typeof v === 'number' && Number.isFinite(v)) : [];
  if (!haze || values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = min === max ? String(min) : `${min}–${max}`;
  const band = haze.psiBand?.trim() ? `, ${haze.psiBand}` : '';
  return `24-h PSI ${range}${band}`;
}

export default function NeaContextCard({ loading, nea, drift, fellBack, error }: NeaContextCardProps) {
  if (loading) return <p className="nea-loading">Loading NEA context…</p>;
  if (!nea || !drift) return null;
  const psi = psiSummary(nea);
  return (
    <section className="nea-card" aria-labelledby="nea-heading">
      <h3 id="nea-heading" className="nea-head">
        Context: NEA Singapore (real readings)
      </h3>
      <p>
        <NeaModeBadge mode={nea.dataMode === 'live' ? 'live' : 'historical'} />{' '}
        <time dateTime={nea.observedAt}>{formatUtc(nea.observedAt)}</time>
      </p>
      <p>
        <span className="k">Wind</span> {nea.wind?.label || 'No reading'}{' '}
        <span className="muted">(NEA Singapore stations)</span>
      </p>
      {psi && nea.haze && (
        <p>
          <span className="k">Haze</span> {psi}{' '}
          {nea.dataMode === 'live' && nea.haze.dataMode === 'historical' ? (
            // Wind is live but PSI came from the bundled snapshot: label it separately.
            <span className="badge badge-nea badge-nea--historical">
              SAVED SNAPSHOT <time dateTime={nea.haze.observedAt}>{formatUtc(nea.haze.observedAt)}</time>
            </span>
          ) : (
            <span className="muted">
              · <time dateTime={nea.haze.observedAt}>{formatUtc(nea.haze.observedAt)}</time>
            </span>
          )}
        </p>
      )}
      <p>{drift.text}</p>
      <p className="nea-note">Context only; does not change the review state.</p>
      {fellBack ? (
        <p className="nea-note">Live NEA feed unavailable; showing saved snapshot.</p>
      ) : (
        error && <p className="nea-note">{error}</p>
      )}
      <p className="nea-note nea-source">
        <ExternalLink href={nea.sourceUrl}>{nea.sourceName || 'NEA via data.gov.sg'}</ExternalLink>
      </p>
      {nea.attribution?.trim() && <p className="nea-attribution">{nea.attribution}</p>}
    </section>
  );
}
