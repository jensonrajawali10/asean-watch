// Incident queue: compact cards under the map. Selecting a card sets the same selection as its marker.
import type { Incident, ReviewResult } from '../types';
import { ModeBadge, StateBadge } from './Badges';
import RoadmapList from './RoadmapList';
import { hazardLabel, plural } from './format';

export interface IncidentQueueProps {
  incidents: Incident[];
  reviews: Record<string, ReviewResult>;
  selectedId: string | null;
  /** Id of the replayable scenario incident; every other incident is a static example. */
  scenarioIncidentId: string | null;
  onSelect: (incidentId: string) => void;
}

export default function IncidentQueue({
  incidents,
  reviews,
  selectedId,
  scenarioIncidentId,
  onSelect,
}: IncidentQueueProps) {
  return (
    <section className="panel panel-queue" aria-labelledby="queue-heading">
      <div className="panel-head">
        <h2 id="queue-heading">
          Incidents <span className="panel-meta">({incidents.length})</span>
        </h2>
        <RoadmapList />
      </div>
      {incidents.length === 0 ? (
        <p className="empty queue-empty">No incidents are loaded.</p>
      ) : (
        <ul className="queue-list">
          {incidents.map((incident) => {
            const review = reviews[incident.id];
            const isScenario = incident.id === scenarioIncidentId;
            return (
              <li key={incident.id}>
                <button
                  type="button"
                  className="queue-item"
                  aria-current={incident.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(incident.id)}
                >
                  <span className="queue-title">{incident.title}</span>
                  <span className="queue-meta">
                    {hazardLabel(incident.hazard)} · {incident.locationName}
                  </span>
                  <span className="queue-badges">
                    {review && <StateBadge state={review.state} label={review.label} />}
                    <ModeBadge mode={incident.dataMode} />
                  </span>
                  <span className="queue-foot">
                    {plural(review?.observationCount ?? 0, 'observation', 'observations')} ·{' '}
                    {isScenario ? 'replay scenario' : 'static example'}
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
