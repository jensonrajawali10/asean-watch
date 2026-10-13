// Evidence timeline: the visible records for the selected incident, newest first, in compact rows.
// Each row's title opens the record inspector (a click anywhere on the row does too, for the mouse).
import type { MouseEvent } from 'react';
import type { Incident, ReviewResult } from '../types';
import { CountedPill, ModeBadge, SourceBadge } from './Badges';
import { categoryLabel, formatUtc, formatValue, isNumericValue, plural } from './format';

export interface EvidenceTimelineProps {
  incident: Incident | null;
  missingId: string | null;
  review: ReviewResult | null;
  isScenario: boolean;
  replayIndex: number;
  onInspect: (observationId: string) => void;
}

export default function EvidenceTimeline({
  incident,
  missingId,
  review,
  isScenario,
  replayIndex,
  onInspect,
}: EvidenceTimelineProps) {
  if (!incident || missingId !== null) return null;
  const items = review ? [...review.evidence].reverse() : [];

  const openFromRow = (e: MouseEvent<HTMLElement>, id: string) => {
    if ((e.target as Element).closest('a, button')) return;
    if (window.getSelection()?.toString()) return; // allow selecting text without opening the inspector
    onInspect(id);
  };

  return (
    <section className="timeline-section" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="section-head">
        Evidence{' '}
        <span className="muted">
          · {plural(review?.observationCount ?? items.length, 'observation', 'observations')}, newest first
          {review?.latestObservedAt && (
            <>
              {' · latest '}
              <time dateTime={review.latestObservedAt}>{formatUtc(review.latestObservedAt)}</time> (fictional)
            </>
          )}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="empty">
          No observations at this step.{isScenario ? ' Use Next step to replay the next observations.' : ''}
        </p>
      ) : (
        <ol className="timeline">
          {items.map((e) => {
            const o = e.observation;
            const isNew = isScenario && replayIndex > 0 && o.replayStep === replayIndex;
            const numeric = isNumericValue(o.value);
            return (
              <li key={o.id} className={`record${isNew ? ' record--new' : ''}`} onClick={(ev) => openFromRow(ev, o.id)}>
                <p className="record-top">
                  {isNew && <span className="tag-new">New</span>}
                  <span className="record-cat">{categoryLabel(o.category)}</span>
                  {numeric && <span className="record-value">{formatValue(o.value, o.unit)}</span>}
                  <CountedPill counted={e.counted} />
                </p>
                <h3 className="record-title">
                  <button type="button" className="record-open" onClick={() => onInspect(o.id)}>
                    {o.summary?.trim() || formatValue(o.value, o.unit)}
                  </button>
                </h3>
                <p className="record-times">
                  <span>
                    <span className="k">Observed</span> <time dateTime={o.observedAt}>{formatUtc(o.observedAt)}</time>
                  </span>
                  <span>
                    <span className="k">Ingested</span> <time dateTime={o.ingestedAt}>{formatUtc(o.ingestedAt)}</time>
                  </span>
                </p>
                <p className="record-source">
                  <ModeBadge mode={o.dataMode} /> <SourceBadge name={o.sourceName} url={o.sourceUrl} />
                </p>
                <p className="record-reason">{e.reason}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
