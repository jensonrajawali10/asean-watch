// Volcano card for map mode (docs/UX_V3.md section 2): a small world-eye view on the shared MapCard anatomy.
// - The official level, verbatim, with its issuer and time (OFFICIAL, reserved style).
// - "If it erupted now": where ash at about 5.5–9 km would drift and the first listed towns it would reach,
//   with times (MODELLED SCENARIO from src/lib/eruptionScenario.ts; never a prediction or a warning).
// - The distance-rings note ("distance only; the agency's hazard map is the authority") with the hazard map
//   link.
// - Ash in the air: a relayed Volcanic Ash Advisory naming this volcano when there is one (OFFICIAL, aviation),
//   and always the VAAC Darwin link, which is linked only (VAAC_DARWIN_NOT_RELAYED in volcanoOfficial.ts).
// - "Play ash scenario" and "Open in workspace". No evidence records, watch rules or workflow states here.
import { useId, useMemo } from 'react';
import type { Incident, OfficialWarning } from '../../types';
import type { AshWindData } from '../../lib/ashDrift';
import { SCENARIO_DEFAULT_HOURS, buildEruptionScenario, hoursShort, levelWords, scenarioPlaceRef } from '../../lib/eruptionScenario';
import type { EruptionScenario } from '../../lib/eruptionScenario';
import { MAGMA_LEVEL_LIST, VAAC_DARWIN, WATCHED_VOLCANO_PROVINCE, volcanoOfficialLinks } from '../../lib/volcanoOfficial';
import { localTimeLabel } from '../../lib/places';
import { MapCard } from '../ui/MapCard';
import type { MapCardFact } from '../ui/MapCard';
import { VolcanoIcon } from '../shell/icons';
import { ExternalLink } from './PopoverParts';
import './VolcanoCard.css';

/**
 * The relayed official level, verbatim. Both an OfficialWarning (e.g. findMagmaLevel(warnings, watch) in
 * src/lib/volcanoOfficial.ts) and MapView's OfficialVolcanoLevel (officialVolcanoLevel()) fit this shape.
 */
export interface VolcanoLevelInput {
  /** Verbatim, e.g. "Level III (Siaga)". */
  level: string;
  /** e.g. "PVMBG (Badan Geologi) via MAGMA Indonesia". */
  issuer: string;
  issuedAt: string | null;
  dataMode: 'live' | 'historical';
  /** Fixed reviewed English gloss, e.g. "Level 3 of 4 (Alert)". */
  levelGloss?: string | null;
  /** Capture time, shown when the issuer gives no issue time. */
  retrievedAt?: string;
}

export interface VolcanoCardProps {
  /** The volcano watch (an Incident or a Watch). */
  watch: Pick<Incident, 'id' | 'title' | 'volcanoId' | 'locationName'>;
  /** Display name (default watch.title), e.g. "Merapi". */
  name?: string;
  /** Eyebrow region (default: from watch.locationName, e.g. "Central Java"). */
  region?: string;
  /** The official level for this volcano, verbatim. Null or undefined: "not retrieved", never an all-clear. */
  level: VolcanoLevelInput | null | undefined;
  /** The newest relayed ash advisory naming this volcano (findAshAdvisory); an aviation product, never its level. */
  ashAdvisory?: OfficialWarning | null;
  /** Modelled pressure-level winds (loadAshWind result data). Used when `scenario` is not given. */
  ashWind?: AshWindData | null;
  /** The scenario's "now" (ms): the map scrubber's anchor step, so the card and the plume agree. */
  nowMs: number;
  /** A ready-made scenario (the one the map plume draws). When given, `ashWind` and `nowMs` are not used for it. */
  scenario?: EruptionScenario | null;
  /** Scenario length when the card builds it (default 24 h). */
  scenarioHours?: number;
  /** Starts the plume animation on the map. Without it (or without a scenario) the button is not shown. */
  onPlayScenario?: () => void;
  /** True while the plume animation is running: the button then reads "Stop ash scenario" (a toggle). */
  playing?: boolean;
  /** Opens the analyst workspace's Volcanoes section for this watch. */
  onOpenWorkspace: () => void;
  onClose?: () => void;
  className?: string;
}

/** "13 Oct, 06:52 UTC". */
function utcShort(iso: string | null | undefined): string {
  if (!iso) return 'time not given';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()} ${mon}, ${iso.slice(11, 16)} UTC`;
}

/** "Central Java" from "North of Yogyakarta, Central Java, Indonesia". */
function regionOf(locationName: string): string {
  const parts = locationName.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
}

export default function VolcanoCard({
  watch,
  name,
  region,
  level,
  ashAdvisory = null,
  ashWind = null,
  nowMs,
  scenario: given,
  scenarioHours = SCENARIO_DEFAULT_HOURS,
  onPlayScenario,
  playing = false,
  onOpenWorkspace,
  onClose,
  className,
}: VolcanoCardProps) {
  const headingId = useId();
  const built = useMemo(
    () => (given === undefined ? buildEruptionScenario(ashWind, watch.volcanoId, nowMs, { hours: scenarioHours, name: name ?? watch.title }) : null),
    [given, ashWind, watch.volcanoId, watch.title, name, nowMs, scenarioHours],
  );
  const scenario = given === undefined ? built : given;
  const links = volcanoOfficialLinks(watch.volcanoId);
  const volcanoRef = { country: 'ID', province: (watch.volcanoId && WATCHED_VOLCANO_PROVINCE[watch.volcanoId]) || null };

  const levelFact: MapCardFact = level
    ? {
        label: 'Official level',
        value: level.level,
        tone: 'official',
        note: [
          level.levelGloss,
          level.issuer,
          level.issuedAt
            ? `issued ${utcShort(level.issuedAt)}`
            : level.retrievedAt
              ? `${level.dataMode === 'live' ? 'retrieved' : 'recorded'} ${utcShort(level.retrievedAt)}`
              : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    : { label: 'Official level', value: 'Not retrieved', tone: 'muted', note: 'Check MAGMA Indonesia; no level here is not an all-clear' };

  const ashFact: MapCardFact | null = ashAdvisory
    ? {
        label: 'Ash advisory (aviation)',
        value: ashAdvisory.level,
        tone: ashAdvisory.ended ? 'muted' : 'official',
        note: [
          ashAdvisory.issuer.replace(/\s*\(.*\)$/, ''),
          ashAdvisory.issuedAt ? `issued ${utcShort(ashAdvisory.issuedAt)}` : null,
          ashAdvisory.ended ? 'series ended (NO FURTHER ADVISORIES)' : null,
          'not a public warning',
        ]
          .filter(Boolean)
          .join(' · '),
      }
    : null;

  const wind = scenario?.wind ?? (ashWind ? { dataMode: ashWind.dataMode, retrievedAt: ashWind.retrievedAt } : null);

  return (
    <MapCard
      className={`vcard${className ? ` ${className}` : ''}`}
      icon={<VolcanoIcon size={18} />}
      eyebrow={`Volcano · ${region ?? regionOf(watch.locationName)}`}
      title={name ?? watch.title}
      kind="official"
      kindLabel={level ? 'OFFICIAL LEVEL' : 'LEVEL NOT RETRIEVED'}
      onClose={onClose}
      facts={ashFact ? [levelFact, ashFact] : [levelFact]}
      primaryAction={
        scenario && onPlayScenario
          ? {
              label: playing ? 'Stop ash scenario' : 'Play ash scenario',
              onClick: onPlayScenario,
              title: 'Animate the modelled ash on the map; the time scrubber follows it',
            }
          : undefined
      }
      action={{ label: 'Open full data', onClick: onOpenWorkspace, title: 'Volcanoes section: evidence, ash numbers per height, methods and caveats' }}
      source={
        <>
          Level: <ExternalLink href={MAGMA_LEVEL_LIST.url}>MAGMA Indonesia level list</ExternalLink>
          {level?.dataMode === 'historical' ? ' (recorded; check MAGMA for the current level)' : ''}.
          {wind && (
            <>
              {' '}
              Wind: Open-Meteo pressure-level forecast (CC BY 4.0), {wind.dataMode === 'live' ? 'fetched' : 'saved run'} {utcShort(wind.retrievedAt)}.
            </>
          )}
          {ashAdvisory && (
            <>
              {' '}
              Ash advisory: <ExternalLink href={ashAdvisory.sourceUrl}>advisory text</ExternalLink> (JMA)
              {ashAdvisory.dataMode === 'historical' ? ', saved copy' : ''}.
            </>
          )}
        </>
      }
    >
      <section className="vcard-scn" aria-labelledby={headingId}>
        <header className="vcard-scn__head">
          <h4 id={headingId} className="vcard-scn__title">
            If it erupted now
          </h4>
          <span className="vcard-tag">MODELLED SCENARIO</span>
        </header>
        {scenario ? (
          <>
            <p className="vcard-scn__dir">{scenario.summary.directionShort}.</p>
            {scenario.summary.nearest.length > 0 ? (
              <ol className="vcard-places" aria-label="First listed towns the modelled ash would reach">
                {scenario.summary.nearest.slice(0, 2).map((a) => (
                  <li key={a.place.id} title={`Ash at ${levelWords(a.level)}`}>
                    <span className="vcard-places__name">{a.place.name}</span>
                    <span className="vcard-places__when">
                      {hoursShort(a.hours)}
                      <span className="vcard-places__note"> · {localTimeLabel(a.time, scenarioPlaceRef(a.place), { day: a.hours >= 12, utc: false })}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="vcard-scn__none">
                No listed town falls inside the modelled ash area within {scenario.hours} h. A scenario, not an all-clear.
              </p>
            )}
            <p className="vcard-scn__assume">
              Assumes an eruption from {localTimeLabel(scenario.startISO, volcanoRef, { day: false })} lasting {scenario.emissionHours} h. Not a prediction, a
              dispersion model or a VAAC advisory.
            </p>
          </>
        ) : (
          <p className="vcard-scn__none">Ash scenario unavailable: the forecast winds did not load. For ash in the air, check VAAC Darwin.</p>
        )}
      </section>
      <p className="vcard-line">
        Rings show distance only; the agency&apos;s hazard map is the authority:{' '}
        <ExternalLink href={links.hazardMap.url}>{links.hazardMap.label}</ExternalLink>.
      </p>
      <p className="vcard-line">
        Ash in the air (aviation advisories): <ExternalLink href={VAAC_DARWIN.url}>VAAC Darwin advisories</ExternalLink>, linked only: the Bureau of
        Meteorology&apos;s terms do not allow copying them here. None shown here is not an all-clear.
      </p>
    </MapCard>
  );
}
