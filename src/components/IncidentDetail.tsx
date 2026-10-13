// Incident detail: the selected incident's state and "Why this state?", plus an optional context card.
// Records themselves live in the evidence timeline and the record inspector, not here.
import type { ReactNode } from 'react';
import type { Incident, ReviewResult, Volcano } from '../types';
import { RULE_SUMMARY, RULE_TEXT } from '../lib/reviewRules';
import { CountedPill, ExternalLink, ModeBadge, StateBadge } from './Badges';
import { categoryLabel, formatCoords, formatUtc, hazardLabel } from './format';

export interface IncidentDetailProps {
  incident: Incident | null;
  /** Set when the selected id does not match any loaded incident. */
  missingId: string | null;
  review: ReviewResult | null;
  volcano: Volcano | null;
  isScenario: boolean;
  scenarioIncident: Incident | null;
  onSelect: (incidentId: string) => void;
  onClearSelection: () => void;
  onInspect: (observationId: string) => void;
  /** Optional context card (NEA Singapore); null renders nothing. */
  context?: ReactNode;
}

export default function IncidentDetail(props: IncidentDetailProps) {
  const { incident, missingId, scenarioIncident, onSelect, onClearSelection } = props;

  if (incident) return <SelectedIncident {...props} incident={incident} />;

  return (
    <section className="detail detail--empty" aria-labelledby="detail-heading">
      {missingId !== null ? (
        <div role="alert">
          <h2 id="detail-heading" className="detail-title">
            Incident not found
          </h2>
          <p>
            No incident with the id <code>{missingId}</code> is in the loaded data.
          </p>
          <button type="button" className="btn" onClick={onClearSelection}>
            Back to overview
          </button>
        </div>
      ) : (
        <>
          <h2 id="detail-heading" className="detail-title">
            Select an incident on the map or in the queue.
          </h2>
          {scenarioIncident && (
            <button type="button" className="btn btn-primary" onClick={() => onSelect(scenarioIncident.id)}>
              Open {scenarioIncident.title}
            </button>
          )}
          <p className="muted small">States show analyst workflow urgency, not official alert levels.</p>
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
  context,
}: IncidentDetailProps & { incident: Incident }) {
  const location =
    incident.country && !incident.locationName?.includes(incident.country)
      ? `${incident.locationName}, ${incident.country}`
      : incident.locationName;
  const catalogUrl = volcano?.catalogSource?.url;
  // explanation[0] restates the rule (RULE_SUMMARY); the rule is shown once, as RULE_TEXT.
  const derivation =
    review && review.explanation[0] === RULE_SUMMARY ? review.explanation.slice(1) : (review?.explanation ?? []);

  return (
    <section className="detail" aria-labelledby="detail-heading">
      <h2 id="detail-heading" className="detail-title">
        {incident.title}
      </h2>
      <p className="detail-meta">
        {location || 'Location not recorded'} · {formatCoords(incident.lat, incident.lon)}
      </p>
      <p className="detail-meta">
        <ModeBadge mode={incident.dataMode} /> {hazardLabel(incident.hazard)} ·{' '}
        {isScenario ? 'replay scenario' : 'static example'}
        {volcano && catalogUrl && (
          <>
            {' · '}
            <span title={volcano.catalogSource.name}>
              <ExternalLink href={catalogUrl}>{`${volcano.name} catalog entry (GVP ${volcano.gvpNumber})`}</ExternalLink>
            </span>
          </>
        )}
      </p>

      {review ? (
        <div className="state-block">
          <div className="state-line">
            <StateBadge state={review.state} label={review.label} size="lg" />
            {review.anomalyCategories.length > 0 && (
              <span className="state-cats">{review.anomalyCategories.map(categoryLabel).join(' + ')}</span>
            )}
          </div>
          <p className="state-note">Workflow state, not an official alert level.</p>
        </div>
      ) : (
        <p className="empty">The state could not be worked out for this incident.</p>
      )}

      {review && (
        <details className="disclosure disclosure--primary" key={incident.id}>
          <summary>Why this state?</summary>
          <div className="disclosure-body">
            <p className="rule-text">{RULE_TEXT}</p>
            {review.evidence.length > 0 ? (
              <ul className="why-records">
                {review.evidence.map((e) => (
                  <li key={e.observation.id}>
                    <CountedPill counted={e.counted} />
                    <span>
                      <button type="button" className="link-button" onClick={() => onInspect(e.observation.id)}>
                        {categoryLabel(e.observation.category)}: {e.observation.summary?.trim() || e.observation.id}
                      </button>{' '}
                      <span className="muted">{e.reason}</span>
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

/** Secondary incident detail, collapsed: scenario window, the incident summary and data quality notes. */
export function IncidentExtras({ incident, review }: { incident: Incident | null; review: ReviewResult | null }) {
  if (!incident) return null;
  const qualityNotes = review
    ? [...new Map(review.evidence.map((e) => [e.observation.qualityNote?.trim(), e.observation.category])).entries()].filter(
        ([note]) => Boolean(note),
      )
    : [];
  return (
    <details className="disclosure">
      <summary>Details</summary>
      <div className="disclosure-body">
        <p>
          <span className="k">Scenario window (fictional)</span> {formatUtc(incident.scenarioWindow?.start)} to{' '}
          {formatUtc(incident.scenarioWindow?.end)}
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
