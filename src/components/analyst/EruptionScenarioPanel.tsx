// Analyst workspace, Volcanoes section: the "If it erupted now" ash scenario in full (docs/UX_V3.md section 3).
// Dense on purpose: per volcano and per height the wind at the start, the heading, the ash-front distance at
// 3/6/12/24 (48) h and the places reached with times; then the method, the caveats and the sources. Every
// figure is a MODELLED SCENARIO; official levels are relayed verbatim beside it and never mixed into it.
import { useMemo, useState } from 'react';
import type { Watch } from '../../lib/fixtures';
import type { OfficialWarning } from '../../types';
import type { AshWindData } from '../../lib/ashDrift';
import {
  DIRECTION_HOURS,
  PUFF_SPREAD_KM_PER_H,
  PUFF_START_RADIUS_KM,
  SCENARIO_STEP_MIN,
  buildEruptionScenario,
  heading,
  levelWords,
  scenarioPlaceRef,
} from '../../lib/eruptionScenario';
import type { EruptionScenario } from '../../lib/eruptionScenario';
import { localTimeLabel } from '../../lib/places';
import { findMagmaLevel, scenarioSources, volcanoOfficialLinks } from '../../lib/volcanoOfficial';
import { AnalystSubhead } from './AnalystSection';
import './analyst.css';
import './EruptionScenarioPanel.css';

export interface EruptionScenarioPanelProps {
  /** Watch areas; only volcano watches (with a volcanoId) are shown. */
  watches: readonly Pick<Watch, 'id' | 'title' | 'volcanoId' | 'locationName' | 'hazard'>[];
  /** Modelled pressure-level winds (loadAshWind result data). */
  ashWind: AshWindData | null | undefined;
  /** The scenario's "now" (ms): the map scrubber's anchor step, as for the card and the plume. */
  nowMs: number;
  /** Official warnings list; each volcano's MAGMA level is shown verbatim beside its scenario. */
  warnings?: readonly OfficialWarning[] | null;
  /** Initial scenario length (24 or 48 h; the reader can switch). */
  initialHours?: 24 | 48;
  /** Highlights this watch (e.g. the one selected on the map). */
  selectedWatchId?: string | null;
  /** "Play on map" per volcano. */
  onPlayScenario?: (watchId: string) => void;
  /** Volcano name click (select it on the map). */
  onSelectWatch?: (watchId: string) => void;
  /** Show the method, caveats and sources blocks (default true). */
  withMethods?: boolean;
}

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US'));
const fmtH = (h: number) => {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 0 ? `${whole} h` : `${whole} h ${String(min).padStart(2, '0')}`;
};
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function VolcanoBlock({
  watch,
  scenario,
  level,
  selected,
  onPlayScenario,
  onSelectWatch,
}: {
  watch: EruptionScenarioPanelProps['watches'][number];
  scenario: EruptionScenario | null;
  level: OfficialWarning | null;
  selected: boolean;
  onPlayScenario?: (watchId: string) => void;
  onSelectWatch?: (watchId: string) => void;
}) {
  const links = volcanoOfficialLinks(watch.volcanoId);
  const tickHours = scenario ? [3, 6, 12, 24, 48].filter((h) => h <= scenario.hours) : [];
  return (
    <div className={`an-scn${selected ? ' an-scn--selected' : ''}`}>
      <div className="an-scn__head">
        <h4 className="an-scn__title">
          {onSelectWatch ? (
            <button type="button" className="an-row-btn" onClick={() => onSelectWatch(watch.id)}>
              {watch.title}
            </button>
          ) : (
            watch.title
          )}
        </h4>
        {scenario && onPlayScenario && (
          <button type="button" className="an-row-btn" onClick={() => onPlayScenario(watch.id)}>
            Play on map
          </button>
        )}
      </div>
      <p className="an-note an-note--official">
        <strong>Official level:</strong>{' '}
        {level ? (
          <>
            {level.level}
            {level.levelGloss ? ` · ${level.levelGloss}` : ''} · {level.issuer} · {level.dataMode === 'live' ? 'issued' : 'recorded'}{' '}
            {utc(level.issuedAt ?? level.retrievedAt)}
            {level.dataMode === 'historical' ? '; check MAGMA for the current level' : ''}.
          </>
        ) : (
          <>unavailable here: check MAGMA Indonesia directly.</>
        )}{' '}
        Hazard map:{' '}
        <a href={links.hazardMap.url} target="_blank" rel="noopener noreferrer">
          {links.hazardMap.label}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        {links.hazardMap.note ? ` (${links.hazardMap.note.toLowerCase()})` : ''}.
      </p>
      {!scenario ? (
        <p className="an-muted">Scenario unavailable: no pressure-level wind for this volcano. For ash in the air, check VAAC Darwin.</p>
      ) : (
        <>
          <p>
            <span className="an-tag">MODELLED SCENARIO</span> {scenario.summary.sentence}
          </p>
          <div className="an-table-wrap">
            <table className="an-table">
              <caption>
                Ash front (the first puff) from the vent, eruption assumed {utc(scenario.startISO)} for {scenario.emissionHours} h. Heading: vent to
                front after {Math.min(DIRECTION_HOURS, scenario.hours)} h; "then" is the front&apos;s later direction.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Height</th>
                  <th scope="col">Wind at start</th>
                  <th scope="col">Heading</th>
                  {tickHours.map((h) => (
                    <th scope="col" className="an-num" key={h}>
                      {h} h
                    </th>
                  ))}
                  <th scope="col">Towns reached (first ash)</th>
                </tr>
              </thead>
              <tbody>
                {scenario.levels.map((l) => (
                  <tr key={l.level}>
                    <th scope="row">
                      {l.label} <span className="an-muted">({l.hPa})</span>
                    </th>
                    <td>
                      {l.windAtStart ? (
                        <>
                          from {heading(l.windAtStart.fromDeg).compass}, {l.windAtStart.speedMs.toFixed(1)} m/s
                        </>
                      ) : (
                        'n/a'
                      )}
                    </td>
                    <td>
                      {l.heading ? l.heading.words : 'stays near the summit'}
                      {l.laterHeading && l.heading && l.laterHeading.compass !== l.heading.compass ? `, then ${l.laterHeading.words}` : ''}
                    </td>
                    {tickHours.map((h) => {
                      const t = l.ticks.find((k) => k.hour === h);
                      return (
                        <td className="an-num" key={h}>
                          {t ? `${fmtKm(t.distanceKm)} km` : 'n/a'}
                        </td>
                      );
                    })}
                    <td>{l.placesReached.length ? l.placesReached.map((p) => `${p.place.name} ${fmtH(p.hours)}`).join(', ') : 'none listed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scenario.arrivals.length > 0 && (
            <div className="an-table-wrap">
              <table className="an-table">
                <caption>
                  First time each listed town lies inside the modelled ash (any height), to the nearest {SCENARIO_STEP_MIN} minutes. Distance is
                  from the vent.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Town</th>
                    <th scope="col" className="an-num">
                      After
                    </th>
                    <th scope="col">Time</th>
                    <th scope="col">Height</th>
                    <th scope="col" className="an-num">
                      Distance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.arrivals.map((a) => (
                    <tr key={a.place.id}>
                      <th scope="row">{a.place.name}</th>
                      <td className="an-num">{fmtH(a.hours)}</td>
                      <td>{localTimeLabel(a.time, scenarioPlaceRef(a.place))}</td>
                      <td>{levelWords(a.level)}</td>
                      <td className="an-num">{fmtKm(a.distanceKm)} km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function EruptionScenarioPanel({
  watches,
  ashWind,
  nowMs,
  warnings = null,
  initialHours = 24,
  selectedWatchId = null,
  onPlayScenario,
  onSelectWatch,
  withMethods = true,
}: EruptionScenarioPanelProps) {
  const [hours, setHours] = useState<24 | 48>(initialHours);
  const volcanoes = useMemo(() => watches.filter((w) => w.hazard === 'volcano' && w.volcanoId), [watches]);
  const scenarios = useMemo(
    () => volcanoes.map((w) => ({ watch: w, scenario: buildEruptionScenario(ashWind, w.volcanoId, nowMs, { hours, name: w.title }) })),
    [volcanoes, ashWind, nowMs, hours],
  );
  const first = scenarios.find((s) => s.scenario)?.scenario ?? null;

  return (
    <div className="an-scn-panel">
      <AnalystSubhead>If it erupted now: ash scenario by height</AnalystSubhead>
      <p className="an-lede">
        For each watched volcano, where ash released at about 3, 5.5 and 9 km would travel with the forecast winds if an eruption started at the
        map&apos;s &quot;now&quot;{first ? ` (${utc(first.startISO)})` : ''}. A MODELLED SCENARIO for planning a report: not a prediction, not a
        dispersion model and not a VAAC advisory.
      </p>
      <div className="an-scn__controls" role="group" aria-label="Scenario length">
        {([24, 48] as const).map((h) => (
          <button key={h} type="button" className="an-scn__toggle" aria-pressed={hours === h} onClick={() => setHours(h)}>
            {h} h
          </button>
        ))}
        {first && first.hours < hours && <span className="an-muted"> The wind data allow {first.hours} h.</span>}
        {ashWind && (
          <span className="an-muted">
            {' '}
            Wind: {ashWind.dataMode === 'live' ? 'live' : 'snapshot'} Open-Meteo run, {utc(ashWind.retrievedAt)}.
          </span>
        )}
      </div>
      {!ashWind && <p className="an-note">Forecast winds unavailable, so no scenario can be drawn. For ash in the air, check VAAC Darwin.</p>}
      {scenarios.map(({ watch, scenario }) => (
        <VolcanoBlock
          key={watch.id}
          watch={watch}
          scenario={scenario}
          level={findMagmaLevel(warnings, watch)}
          selected={watch.id === selectedWatchId}
          onPlayScenario={onPlayScenario}
          onSelectWatch={onSelectWatch}
        />
      ))}
      {withMethods && (
        <>
          <AnalystSubhead>Method</AnalystSubhead>
          <p>
            An eruption is assumed to start at the time shown and to last the whole scenario. Every hour one ash puff leaves the vent at each of
            three heights: 700 hPa (about 3 km), 500 hPa (about 5.5 km) and 300 hPa (about 9 km). Each puff moves with the Open-Meteo forecast
            wind at that height above the summit, which changes hour by hour ({SCENARIO_STEP_MIN}-minute steps, wind interpolated in time). Each
            puff starts {PUFF_START_RADIUS_KM} km wide in radius and widens by {PUFF_SPREAD_KM_PER_H} km per hour, an illustrative rate (twice
            the long-range spread of about 0.5 m/s × travel time from Heffter, 1965). The release is continuous, so the puffs of one height are
            joined into one tapered band; the map outline is the union of the three bands. A town is &quot;reached&quot; the first time it lies
            inside a band.
          </p>
          <AnalystSubhead>Caveats</AnalystSubhead>
          <ul className="an-scn__caveats">
            {(first?.summary.caveats ?? []).map((c) => (
              <li key={c}>{c}</li>
            ))}
            <li>
              Not modelled: ash falling to the ground, particle sizes, concentrations, the plume spreading under its own weight, terrain and rain.
              The wind at the summit is used along the whole path.
            </li>
            <li>The towns list is a fixed set (towns near each volcano and the map&apos;s air-quality cities); a town not listed can still be under ash.</li>
          </ul>
          <AnalystSubhead>Sources</AnalystSubhead>
          <ol className="an-scn__sources">
            {scenarioSources(ashWind).map((s) => (
              <li key={s.label}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.label}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  s.label
                )}
                {s.mode && <span className="an-tag">{s.mode}</span>}
                {s.retrievedAt && <span className="an-muted"> · {utc(s.retrievedAt)}</span>}
                {s.licence && <span className="an-muted"> · {s.licence}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
