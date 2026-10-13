// STUB: owned by the map agent. Props are the contract; body gets replaced.
import type { Incident, ReviewState } from '../types';

export interface RegionMapProps {
  incidents: Incident[];
  selectedId: string | null;
  /** Review state per incident id, for marker styling. */
  states: Record<string, ReviewState>;
  onSelect: (incidentId: string) => void;
}

export default function RegionMap({ incidents, selectedId, onSelect }: RegionMapProps) {
  return (
    <div className="region-map">
      {incidents.map((i) => (
        <button key={i.id} aria-pressed={i.id === selectedId} onClick={() => onSelect(i.id)}>
          {i.title}
        </button>
      ))}
    </div>
  );
}
