// Watch areas: the rail list of places under watch. Selecting a row sets the same selection as its map
// marker. Each row shows the name, hazard and location, the current review state and the record count.
import type { Incident, ReviewResult } from '../types';
import { StateBadge } from './Badges';
import { hazardLabel } from './format';

export interface IncidentQueueProps {
  incidents: Incident[];
  reviews: Record<string, ReviewResult>;
  selectedId: string | null;
  /** Id of the replayable watch area; every other one is shown as it is. */
  scenarioIncidentId: string | null;
  onSelect: (incidentId: string) => void;
  /** Optional short names per incident id (e.g. the volcano name). */
  placeNames?: Record<string, string>;
  /** Clears the selection (back to the APAC-wide view); the button shows only while something is selected. */
  onClearSelection?: () => void;
}

export default function IncidentQueue({
  incidents,
  reviews,
  selectedId,
  scenarioIncidentId,
  onSelect,
  placeNames,
  onClearSelection,
}: IncidentQueueProps) {
  return (
    <section className="panel rail-panel rail-watch" aria-labelledby="queue-heading">
      <div className="panel-head">
        <h2 id="queue-heading">
          Areas <span className="panel-meta">({incidents.length})</span>
        </h2>
        {selectedId !== null && onClearSelection && (
          <button type="button" className="link-button head-action" onClick={onClearSelection}>
            Show all areas
          </button>
        )}
      </div>
      {incidents.length === 0 ? (
        <p className="empty queue-empty">No watch areas are loaded.</p>
      ) : (
        <ul className="watch-list">
          {incidents.map((incident) => {
            const review = reviews[incident.id];
            const isScenario = incident.id === scenarioIncidentId;
            const name = placeNames?.[incident.id]?.trim() || incident.title;
            const count = review?.observationCount ?? 0;
            return (
              <li key={incident.id}>
                <button
                  type="button"
                  className="watch-row"
                  aria-current={incident.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(incident.id)}
                >
                  <span className="watch-title">{name}</span>
                  <span className="watch-meta">
                    {hazardLabel(incident.hazard)} · {count} {count === 1 ? 'detection' : 'detections'}
                    {isScenario ? ' · replay' : ''}
                    <span className="visually-hidden"> · {incident.locationName}</span>
                  </span>
                  <span className="watch-state">
                    {review && <StateBadge state={review.state} label={review.label} size="sm" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
