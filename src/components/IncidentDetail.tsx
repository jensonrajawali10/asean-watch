// Watch-area detail: the selected area's properties, the relayed official level (reserved style,
// apart from our state), our workflow state, "Why this state?", and an optional context card.
// Records themselves live in the evidence timeline and the record inspector, not here.
import type { ReactNode } from 'react';
import type { Incident, OfficialWarning, ReviewResult, SourceRef, Volcano } from '../types';
import { RULE_SUMMARY, RULE_TEXT } from '../lib/reviewRules';
import { officialLevelFor } from '../lib/warningsView';
import { useNowMs } from '../lib/useNowMs';
import { CountedPill, ExternalLink, ModeBadge, OfficialLevelChip, OfficialTag, StateBadge } from './Badges';
import { categoryLabel, formatCoords, formatUtc, hazardLabel } from './format';

export interface IncidentDetailProps {
  incident: Incident | null;
  /** Set when the selected id does not match any loaded watch area. */
  missingId: string | null;
  review: ReviewResult | null;
  volcano: Volcano | null;
  isScenario: boolean;
  scenarioIncident: Incident | null;
  onSelect: (incidentId: string) => void;
  onClearSelection: () => void;
  onInspect: (observationId: string) => void;
  /** Official warnings near this area (already filtered and sorted); the active one for this hazard is cross-referenced. */
  officialNear?: OfficialWarning[];
  onInspectWarning?: (warningId: string) => void;
  /** Optional context card (NEA Singapore); null renders nothing. */
  context?: ReactNode;
  /** Short display name (e.g. the volcano name); falls back to the title. */
  placeName?: string;
  /** Reference links for this watch area (official level page, independent monitoring). */
  references?: SourceRef[];
  /** Plain-language watch rules for this area (illustrative workflow rules, not official thresholds). */
  watchRules?: string[];
}

export default function IncidentDetail(props: IncidentDetailProps) {
  const { incident, missingId, scenarioIncident, onSelect, onClearSelection } = props;

  if (incident) return <SelectedIncident {...props} incident={incident} />;

  return (
    <section className="detail detail--empty" aria-labelledby="detail-heading">
      {missingId !== null ? (
        <div role="alert">
          <h2 id="detail-heading" className="detail-title">
            Watch area not found
          </h2>
          <p>
            No watch area with the id <code>{missingId}</code> is in the loaded data.
          </p>
          <button type="button" className="btn" onClick={onClearSelection}>
            Back to overview
          </button>
        </div>
      ) : (
        <>
          <h2 id="detail-heading" className="detail-title">
            Select a watch area on the map or in the list.
          </h2>
          {scenarioIncident && (
            <button type="button" className="btn btn-primary" onClick={() => onSelect(scenarioIncident.id)}>
              Open {props.placeName ?? scenarioIncident.title}
            </button>
          )}
          <p className="muted small">
            Each area shows its official agency level (relayed verbatim) and our own workflow state, which is not an
            alert level.
          </p>
        </>
      )}
    </section>
  );
}

function SelectedIncident({
  incident,
  review,
  volcano,
  isScenario,
  onInspect,
  officialNear = [],
  onInspectWarning,
  context,
  references = [],
  watchRules = [],
}: IncidentDetailProps & { incident: Incident }) {
  const location =
    incident.country && !incident.locationName?.includes(incident.country)
      ? `${incident.locationName}, ${incident.country}`
      : incident.locationName;
  const catalogUrl = volcano?.catalogSource?.url;
  // explanation[0] restates the rule (RULE_SUMMARY); the rule is shown once, as RULE_TEXT.
  const derivation =
    review && review.explanation[0] === RULE_SUMMARY ? review.explanation.slice(1) : (review?.explanation ?? []);
  const nowMs = useNowMs();
  const official = officialLevelFor(incident, officialNear, nowMs);
  const moreOfficial = officialNear.length - (official ? 1 : 0);

  return (
    <section className="detail" aria-labelledby="detail-heading">
      <h2 id="detail-heading" className="detail-title">
        {incident.title}
      </h2>
      <p className="detail-meta">
        {location || 'Location not recorded'} · <span className="mono">{formatCoords(incident.lat, incident.lon)}</span>
      </p>
      <p className="detail-meta">
        {hazardLabel(incident.hazard)}
        {isScenario ? ' · last 7 days' : ''}
        {volcano && catalogUrl && (
          <>
            {' · '}
            <span title={volcano.catalogSource.name}>
              <ExternalLink href={catalogUrl}>{`Smithsonian GVP ${volcano.gvpNumber}`}</ExternalLink>
            </span>
          </>
        )}
      </p>
      {references.length > 0 && (
        <p className="detail-meta detail-refs">
          <span className="k">Also see</span>
          {references.map((ref, i) => (
            <span key={ref.url} title={ref.name}>
              {i > 0 ? ' · ' : ' '}
              <ExternalLink href={ref.url}>{shortRefName(ref.name)}</ExternalLink>
            </span>
          ))}
        </p>
      )}

      {official && (
        <div className="official-xref" lang={undefined}>
          <p className="official-xref-head">
            <OfficialTag issuer={official.issuer} authority="official" />{' '}
            <ModeBadge mode={official.dataMode} time={official.retrievedAt} title="Data mode and retrieval time" />
          </p>
          <p className="official-xref-level">
            <OfficialLevelChip level={official.level} gloss={official.levelGloss} />
          </p>
          <p className="official-xref-actions">
            {onInspectWarning && (
              <button type="button" className="link-button" onClick={() => onInspectWarning(official.id)}>
                Details
              </button>
            )}
            <ExternalLink className="official-follow" href={official.issuerUrl}>
              Follow {official.issuer}
            </ExternalLink>
          </p>
          <p className="official-xref-note">
            Shown exactly as issued{moreOfficial > 0 ? `; ${moreOfficial} more in the Warnings section` : ''}.
          </p>
        </div>
      )}

      {review ? (
        <div className="state-block">
          <div className="state-line">
            <StateBadge state={review.state} label={review.label} size="lg" />
            {review.anomalyCategories.length > 0 && (
              <span className="state-cats">{review.anomalyCategories.map(categoryLabel).join(' + ')}</span>
            )}
          </div>
          <p className="state-note">Our workflow state from stated watch rules, not an official alert level.</p>
        </div>
      ) : (
        <p className="empty">The state could not be worked out for this watch area.</p>
      )}

      {review && (
        <details className="disclosure disclosure--primary" key={incident.id}>
          <summary>Why this state?</summary>
          <div className="disclosure-body">
            <p className="rule-text">{RULE_TEXT}</p>
            {watchRules.length > 0 && (
              <ul className="watch-rules">
                {watchRules.map((rule) => (
                  <li key={rule}>
                    <span className="k">Watch rule</span> {rule}
                  </li>
                ))}
              </ul>
            )}
            {review.evidence.length > 0 ? (
              <ul className="why-records">
                {review.evidence.map((e) => (
                  <li key={e.observation.id}>
                    <CountedPill counted={e.counted} />
                    <span className="why-text">
                      <button type="button" className="link-button" onClick={() => onInspect(e.observation.id)}>
                        {categoryLabel(e.observation.category)}: {e.observation.summary?.trim() || e.observation.id}
                      </button>{' '}
                      <span className="muted">{e.reason}</span>
                      {e.observation.anomaly && e.observation.anomalyReason?.trim() && (
                        <span className="why-rule">
                          <span className="k">Watch rule</span> {e.observation.anomalyReason}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No records at this step.</p>
            )}
            {derivation.length > 0 && (
              <details className="nested">
                <summary>Full derivation</summary>
                <ul className="why-lines">
                  {derivation.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </details>
      )}

      {context}
    </section>
  );
}

/** "PVMBG / MAGMA Indonesia volcano activity levels (official)" → "PVMBG / MAGMA Indonesia (official)". */
function shortRefName(name: string): string {
  const trimmed = name.trim();
  const m = /^(.+?)(?:\s+(?:volcano activity levels|satellite monitoring)[^()]*)?(\s*\(.*\))?$/i.exec(trimmed);
  if (!m) return trimmed;
  const head = m[1].replace(/[:\s]+$/, '');
  const paren = m[2]?.trim() ?? '';
  // "not official" / "independent" is tested first: "(independent research, not official)" is never "(official)".
  const note = /not official|independent/i.test(paren) ? ' (not official)' : /official/i.test(paren) ? ' (official)' : '';
  return `${head}${note}`;
}

/** Secondary detail, collapsed: watch window, the area summary and data quality notes. */
export function IncidentExtras({ incident, review }: { incident: Incident | null; review: ReviewResult | null }) {
  if (!incident) return null;
  const qualityNotes = review
    ? [...new Map(review.evidence.map((e) => [e.observation.qualityNote?.trim(), e.observation.category])).entries()].filter(
        ([note]) => Boolean(note),
      )
    : [];
  return (
    <details className="disclosure">
      <summary>About this area</summary>
      <div className="disclosure-body">
        <p>
          <span className="k">Period checked</span>{' '}
          <time dateTime={incident.scenarioWindow?.start}>{formatUtc(incident.scenarioWindow?.start)}</time> to{' '}
          <time dateTime={incident.scenarioWindow?.end}>{formatUtc(incident.scenarioWindow?.end)}</time>
        </p>
        {incident.summary?.trim() && <p className="detail-summary">{incident.summary}</p>}
        {qualityNotes.length > 0 && (
          <>
            <h3 className="mini-title">Data quality notes</h3>
            <ul className="quality-list">
              {qualityNotes.map(([note, category]) => (
                <li key={note}>
                  <span className="k">{categoryLabel(category)}</span> {note}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
