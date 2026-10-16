// The card switch for map mode (docs/UX_V3.md section 2): one small card for the one thing selected on the
// map. Every card uses the MapCard anatomy and ends with "Open in workspace →". This is the seam where the
// teammates' cards plug in (VolcanoCard from the eruption module, FireCard from the fires module); until a
// module lands, an interim card built from data already loaded stands in, and says what it lacks.
import type { HazeReading, Incident, OfficialWarning } from '../../types';
import type { AirQualityData } from '../../lib/airQuality';
import type { WindGrid } from '../../lib/windField';
import type { AshWindData } from '../../lib/ashDrift';
import type { EruptionScenario } from '../../lib/eruptionScenario';
import { EndedChip, ExternalLink, OfficialLevelChip } from '../Badges';
import { isExpired } from '../../lib/warningsView';
import { useNowMs } from '../../lib/useNowMs';
import { formatUtc } from '../format';
import { MapCard } from '../ui/MapCard';
import { FireIcon, WarningIcon } from '../shell/icons';
import type { MapSelection, SectionId } from '../shell/workspace';
import { clusterAt, regionalBadges } from '../../lib/fires';
import type { FireSnapshot } from '../../lib/fires';
import CityCard from './CityPopover';
import { FireCard } from './FireCard';
import VolcanoCard from './VolcanoCard';
import type { FirePick } from './fireLayers';
import type { HazeHour } from './useHazeHour';
import type { OfficialVolcanoLevel } from './volcanoLevels';

export interface MapCardsProps {
  selection: MapSelection | null;
  onClose: () => void;
  onOpenWorkspace: (section: SectionId) => void;
  airQuality: AirQualityData | null;
  hazeHour: HazeHour;
  wind925: WindGrid | null;
  neaHaze: HazeReading | null;
  incidents: Incident[];
  placeNames: Record<string, string>;
  levels: Record<string, OfficialVolcanoLevel | null>;
  ashWind: AshWindData | null;
  /** Watch id whose ash scenario is playing. */
  scenarioId: string | null;
  /** The selected volcano's "If it erupted now" scenario (shared with the plume and the panel). */
  scenario: EruptionScenario | null;
  /** The scrubber's anchor step (ms): the scenario's "now". */
  anchorMs: number;
  onPlayScenario: (watchId: string) => void;
  /** The FIRMS whole-region snapshot (fires module); null when it could not be read. */
  fireSnapshot: FireSnapshot | null;
  /** The fire object selected on the map (resolved from the selection id). */
  firePick: FirePick | null;
  warnings: OfficialWarning[];
  onInspectWarning: (id: string) => void;
}

export default function MapCards(p: MapCardsProps) {
  const sel = p.selection;
  if (!sel) return null;
  const close = p.onClose;

  if (sel.kind === 'city') {
    if (!p.airQuality || !p.hazeHour.timeISO) return <LoadingCard title="City" onClose={close} what="the air-quality forecast" />;
    return (
      <CityCard
        cityId={sel.id}
        airQuality={p.airQuality}
        timeISO={p.hazeHour.timeISO}
        nowISO={p.hazeHour.steps.times[p.hazeHour.steps.nowIndex] ?? p.hazeHour.timeISO}
        wind={p.wind925}
        neaHaze={p.neaHaze}
        onClose={close}
        onOpenWorkspace={() => p.onOpenWorkspace('haze')}
      />
    );
  }

  if (sel.kind === 'warning') {
    const w = p.warnings.find((x) => x.id === sel.id) ?? null;
    if (!w) return <LoadingCard title="Official warning" onClose={close} what="this message (it may have been withdrawn)" />;
    return <WarningCard w={w} onClose={close} onInspect={() => p.onInspectWarning(w.id)} onOpenWorkspace={() => p.onOpenWorkspace('warnings')} />;
  }

  const fireCard = (pick: FirePick) =>
    p.fireSnapshot ? (
      <FireCard
        pick={pick}
        snapshot={p.fireSnapshot}
        windGrid={p.wind925}
        smokeStartISO={p.hazeHour.timeISO || undefined}
        onOpenWorkspace={() => p.onOpenWorkspace('fires')}
        onClose={close}
      />
    ) : null;

  if (sel.kind === 'fire') {
    const card = p.firePick ? fireCard(p.firePick) : null;
    return card ?? <LoadingCard title="Fires" onClose={close} what="this fire cluster (it is not in the current snapshot)" />;
  }

  // A watch area: a volcano, or the Riau haze watch box.
  const incident = p.incidents.find((i) => i.id === sel.id) ?? null;
  if (!incident) return <LoadingCard title="Watch area" onClose={close} what={`a watch area called "${sel.id}"`} />;
  const name = p.placeNames[incident.id] ?? incident.title;
  if (incident.hazard === 'volcano') {
    return (
      <VolcanoCard
        watch={incident}
        name={name}
        level={p.levels[incident.id] ?? null}
        scenario={p.scenario && p.scenario.volcanoId === incident.volcanoId ? p.scenario : null}
        nowMs={p.anchorMs}
        ashWind={p.ashWind}
        playing={p.scenarioId === incident.id}
        onPlayScenario={() => p.onPlayScenario(incident.id)}
        onOpenWorkspace={() => p.onOpenWorkspace('volcanoes')}
        onClose={close}
      />
    );
  }
  // The haze watch box (Riau): the fire cluster there, else its province, from the whole-region snapshot.
  const snap = p.fireSnapshot;
  if (snap) {
    const cluster = clusterAt(snap, incident.lat, incident.lon);
    if (cluster) return fireCard({ kind: 'fire-cluster', cluster });
    const badge = regionalBadges(snap, '24h', 40).find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null;
    if (badge) return fireCard({ kind: 'fire-region', badge });
  }
  return (
    <MapCard
      icon={<FireIcon size={18} />}
      eyebrow={`Haze watch area · ${incident.locationName}`}
      title={name}
      kind="measured"
      kindLabel="MEASURED · SATELLITE"
      onClose={close}
      sentence="No satellite fire cluster is listed here in the current snapshot. That is not an all-clear: cloud and smoke hide hotspots."
      action={{ label: 'Open in workspace', onClick: () => p.onOpenWorkspace('fires'), title: 'Fires section: counts and fire power by region' }}
      source="NASA FIRMS (VIIRS and MODIS)"
    />
  );
}

function LoadingCard({ title, what, onClose }: { title: string; what: string; onClose: () => void }) {
  return <MapCard title={title} kind="catalog" kindLabel="NOT LOADED" onClose={onClose} sentence={`Waiting for ${what}.`} />;
}

// ---------------------------------------------------------------------------------------------
// Official warning: the issuer's words, verbatim, in the reserved style.

function WarningCard({ w, onClose, onInspect, onOpenWorkspace }: { w: OfficialWarning; onClose: () => void; onInspect: () => void; onOpenWorkspace: () => void }) {
  const estimate = w.authority === 'aggregator';
  const lang = w.language || undefined;
  const nowMs = useNowMs();
  const ended = isExpired(w, nowMs);
  return (
    <MapCard
      className="warning-card"
      icon={<WarningIcon size={18} />}
      eyebrow={estimate ? `Impact estimate · ${w.issuer}` : `Official · ${w.issuer}`}
      title={w.areaDescription.trim() || w.product || w.issuer}
      kind={estimate ? 'aggregator' : 'official'}
      kindLabel={estimate ? 'ESTIMATE, NOT A WARNING' : 'OFFICIAL'}
      onClose={onClose}
      action={{ label: 'Open in workspace', onClick: onOpenWorkspace, title: 'Warnings section: every message, verbatim, with feed status' }}
      source={
        <>
          Shown exactly as issued ({w.dataMode === 'live' ? 'live' : `saved ${formatUtc(w.retrievedAt)}`}). ASEAN Watch never issues warnings of its own.
        </>
      }
    >
      <div className="warning-card__level">
        <OfficialLevelChip level={w.level} gloss={w.levelGloss} ended={ended} authority={w.authority} />
        <EndedChip warning={w} nowMs={nowMs} />
      </div>
      <p className="warning-card__headline" lang={lang}>
        {w.headline.trim()}
      </p>
      <p className="warning-card__meta">{w.issuedAt ? <>Issued {formatUtc(w.issuedAt)}</> : <>No issue time published</>}</p>
      <p className="warning-card__links">
        <ExternalLink href={w.issuerUrl}>{estimate ? `Open ${w.issuer}` : `Follow ${w.issuer}`}</ExternalLink>
        <button type="button" className="link-button" onClick={onInspect}>
          Full message
        </button>
      </p>
    </MapCard>
  );
}
