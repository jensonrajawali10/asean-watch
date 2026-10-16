// The card switch for map mode (docs/UX_V3.md section 2): one small card for the one thing selected on the
// map. Every card uses the MapCard anatomy and ends with "Open in workspace →". This is the seam where the
// teammates' cards plug in (VolcanoCard from the eruption module, FireCard from the fires module); until a
// module lands, an interim card built from data already loaded stands in, and says what it lacks.
import type { HazeReading, Incident, OfficialWarning, Volcano } from '../../types';
import type { AirQualityData } from '../../lib/airQuality';
import type { WindGrid } from '../../lib/windField';
import { ashDriftTracks, compass16 } from '../../lib/ashDrift';
import type { AshWindData } from '../../lib/ashDrift';
import { volcanoOfficialLinks } from '../../lib/volcanoLinks';
import { EndedChip, ExternalLink, OfficialLevelChip } from '../Badges';
import { isExpired } from '../../lib/warningsView';
import { useNowMs } from '../../lib/useNowMs';
import { formatUtc } from '../format';
import { MapCard } from '../ui/MapCard';
import { FireIcon, VolcanoIcon, WarningIcon } from '../shell/icons';
import type { MapSelection, SectionId } from '../shell/workspace';
import { clusterAt, regionalBadges } from '../../lib/fires';
import type { FireSnapshot } from '../../lib/fires';
import CityCard from './CityPopover';
import { FireCard } from './FireCard';
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
  volcanoes: Volcano[];
  placeNames: Record<string, string>;
  levels: Record<string, OfficialVolcanoLevel | null>;
  ashWind: AshWindData | null;
  /** Watch id whose ash scenario is playing. */
  scenarioId: string | null;
  onPlayScenario: (watchId: string) => void;
  /** The FIRMS whole-region snapshot (fires module); null when it could not be read. */
  fireSnapshot: FireSnapshot | null;
  /** The fire object selected on the map (resolved from the selection id). */
  firePick: FirePick | null;
  warnings: OfficialWarning[];
  onInspectWarning: (id: string) => void;
}

const LEVEL_ISSUER_FALLBACK = 'PVMBG via MAGMA Indonesia';

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
      <VolcanoCardInterim
        incident={incident}
        name={name}
        volcano={p.volcanoes.find((v) => v.id === incident.volcanoId) ?? null}
        level={p.levels[incident.id] ?? null}
        ashWind={p.ashWind}
        playing={p.scenarioId === incident.id}
        onPlay={() => p.onPlayScenario(incident.id)}
        onClose={close}
        onOpenWorkspace={() => p.onOpenWorkspace('volcanoes')}
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

// ---------------------------------------------------------------------------------------------
// Volcano (interim until the eruption module's VolcanoCard lands): the official level verbatim, where ash
// would drift with today's summit winds (modelled), the play button and the hazard-map link. No evidence
// records, watch rules or day replay: those are workspace material.

interface VolcanoCardInterimProps {
  incident: Incident;
  name: string;
  volcano: Volcano | null;
  level: OfficialVolcanoLevel | null;
  ashWind: AshWindData | null;
  playing: boolean;
  onPlay: () => void;
  onClose: () => void;
  onOpenWorkspace: () => void;
}

/** "north-west" style word for a 16-point compass abbreviation. */
const COMPASS_WORDS: Record<string, string> = {
  N: 'north',
  NNE: 'north-north-east',
  NE: 'north-east',
  ENE: 'east-north-east',
  E: 'east',
  ESE: 'east-south-east',
  SE: 'south-east',
  SSE: 'south-south-east',
  S: 'south',
  SSW: 'south-south-west',
  SW: 'south-west',
  WSW: 'west-south-west',
  W: 'west',
  WNW: 'west-north-west',
  NW: 'north-west',
  NNW: 'north-north-west',
};

function VolcanoCardInterim({ incident, name, volcano, level, ashWind, playing, onPlay, onClose, onOpenWorkspace }: VolcanoCardInterimProps) {
  const series = ashWind && incident.volcanoId ? (ashWind.volcanoes.find((v) => v.volcanoId === incident.volcanoId) ?? null) : null;
  const drift = series ? ashDriftTracks(series, Date.now()) : null;
  // Ash at 5 to 10 km: the 500 and 300 hPa tracks (about 5.5 and 9 km).
  const high = drift?.tracks.filter((t) => t.level === '500' || t.level === '300') ?? [];
  const mid = high.find((t) => t.level === '500') ?? high[0] ?? null;
  const toward = mid && mid.bearingDeg !== null ? compass16(mid.bearingDeg) : null;
  const towardWord = toward ? (COMPASS_WORDS[toward] ?? toward) : null;
  const links = volcanoOfficialLinks(incident.volcanoId);
  const region = incident.locationName || volcano?.country || '';
  return (
    <MapCard
      className="volcano-card"
      icon={<VolcanoIcon size={18} />}
      eyebrow={region ? `Volcano · ${region}` : 'Volcano'}
      title={name}
      kind="official"
      kindLabel={level ? 'OFFICIAL LEVEL' : 'LEVEL NOT RETRIEVED'}
      onClose={onClose}
      facts={
        drift
          ? [
              { label: 'Ash at 5–10 km heads', value: toward ?? 'calm', note: 'modelled, summit winds' },
              { label: 'Distance in 24 h', value: mid ? Math.round(mid.distanceKm).toLocaleString('en-US') : '—', unit: 'km', note: 'at about 5.5 km up' },
            ]
          : undefined
      }
      sentence={
        towardWord ? (
          <>
            If it erupted now, ash at 5–10 km would drift toward the {towardWord} <span className="mcard__tag">modelled</span>. A scenario, not a
            prediction or an ash advisory.
          </>
        ) : drift ? (
          'If it erupted now, summit winds at 5–10 km are too light to carry ash far (modelled).'
        ) : (
          'Waiting for the summit winds to show where ash would drift (modelled).'
        )
      }
      primaryAction={drift ? { label: playing ? 'Stop ash scenario' : 'Play ash scenario', onClick: onPlay, title: 'Animate where ash would drift if it erupted now (modelled scenario)' } : undefined}
      action={{ label: 'Open in workspace', onClick: onOpenWorkspace, title: 'Volcanoes section: seven days of evidence, levels and ash numbers' }}
      source={
        <>
          Level: {level?.issuer ?? LEVEL_ISSUER_FALLBACK}
          {level?.issuedAt ? `, ${formatUtc(level.issuedAt)}` : ''}. Ash: Open-Meteo summit winds, {ashWind?.dataMode === 'live' ? 'live' : 'saved'} run.
        </>
      }
    >
      <div className="volcano-card__level">
        {level ? (
          <>
            <OfficialLevelChip level={level.level} />
            <span className="volcano-card__issuer">as issued by {level.issuer}</span>
          </>
        ) : (
          <span className="volcano-card__issuer">
            No official level retrieved. Check <ExternalLink href={links.level.url}>{links.level.label}</ExternalLink>; no level here is not an all-clear.
          </span>
        )}
      </div>
      <p className="volcano-card__rings">
        Rings on the map show distance only; the agency&apos;s hazard map is the authority:{' '}
        <ExternalLink href={links.hazardMap.url}>{links.hazardMap.label}</ExternalLink>
      </p>
    </MapCard>
  );
}
