// Workspace section 2, "Haze & air" (docs/UX_V3.md section 3): every AQ place with now, the 24 h and 48 h
// peaks with local times, the band, the WHO multiple and a 72 h sparkline (sortable); NEA Singapore's
// measured PSI and PM2.5 beside the modelled value and why they differ; smoke transport toward Singapore
// with its caveats; the regional authority (ASMC) and NUS CRISP imagery as verified links; and a methods
// block on CAMS PM2.5. MODELLED values never stand in for measurements, and the text gives no health
// advice of its own: it points to the national agencies.
import { useMemo, useState } from 'react';
import type { NeaContext } from '../../types';
import { PM25_BANDS_NOTE, WHO_PM25_24H_UGM3, placePm25At } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import { AIR_QUALITY_OFFICIAL, COUNTRY_NAME } from '../../lib/places';
import {
  ASMC,
  FIRMS_PAGE,
  HAZE_FUTURE_H,
  NUS_CRISP,
  cityHazeTable,
  modelAnchorISO,
  pmText,
  sortCityRows,
  transportSummaries,
  utcStamp,
  whoMultipleText,
} from '../../lib/situation';
import type { CityHazeRow, CitySortKey, FiresSummary, HotspotSnapshotInfo, TransportSummary } from '../../lib/situation';
import type { HotspotSource } from '../../lib/transport';
import type { WindGrid } from '../../lib/windField';
import { AnalystSection, AnalystSubhead, KeyFigure } from './AnalystSection';
import type { SectionSource } from './AnalystSection';
import { BasisTag, ExtLink, FreshnessChip } from './reportParts';
import './workspaceSections.css';

export interface HazeAirSectionProps {
  /** CAMS PM2.5 (App's airQuality); null while loading or when unavailable. */
  airQuality: AirQualityData | null;
  /** App's neaResult?.context. */
  nea: NeaContext | null;
  /** App's neaResult?.error. */
  neaError?: string | null;
  /** True while the NEA load has not settled (App's neaResult === null). */
  neaLoading?: boolean;
  /** 10 m wind grid (App's windResult?.grid), the level of the map's haze paths. */
  wind10m?: WindGrid | null;
  /** 925 hPa wind grid (App's wind925), the smoke-transport level. */
  wind925?: WindGrid | null;
  /** Fire clusters to start paths from, e.g. hazeSourcesFromFixtures(FIXTURES). */
  hazeSources?: readonly HotspotSource[] | null;
  /** FIXTURES.snapshot, for the clusters' time. */
  hotspotSnapshot?: HotspotSnapshotInfo | null;
  /** Optional regional fire summary: its clusters become extra transport sources. */
  fires?: FiresSummary | null;
  /** Start the paths here (e.g. App's transport?.time) so the table matches the map. */
  transportStartISO?: string | null;
  /** The map scrubber's hour (App's hazeHour.timeISO): adds a column with each place's value at that hour. */
  scrubberISO?: string | null;
  /** City highlighted on the map, if any. */
  selectedCityId?: string | null;
  onFlyTo?: (lat: number, lon: number) => void;
  onSelectCity?: (id: string) => void;
}

const SORTS: ReadonlyArray<{ key: CitySortKey; label: string }> = [
  { key: 'now', label: 'Worst now' },
  { key: 'peak48h', label: `Worst ${HAZE_FUTURE_H} h peak` },
  { key: 'mean24h', label: 'Highest 24 h mean' },
  { key: 'name', label: 'Name' },
];

// ---------------------------------------------------------------------------

function Sparkline({ row, anchorISO, unit }: { row: CityHazeRow; anchorISO: string; unit: string }) {
  const W = 72;
  const Hh = 22;
  const a = Date.parse(anchorISO);
  const x0 = a - 24 * 3_600_000;
  const x1 = a + HAZE_FUTURE_H * 3_600_000;
  const max = Math.max(WHO_PM25_24H_UGM3 * 1.2, ...row.series.map((p) => p.value));
  const x = (iso: string) => ((Date.parse(iso) - x0) / (x1 - x0)) * W;
  const y = (v: number) => Hh - 1 - (Math.max(0, v) / max) * (Hh - 2);
  const path = (pts: typeof row.series) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.timeISO).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const past = row.series.filter((p) => !p.future);
  const future = [...past.slice(-1), ...row.series.filter((p) => p.future)];
  const label =
    `${row.name}: modelled PM2.5 from 24 h before to ${HAZE_FUTURE_H} h after the model hour, ` +
    `${pmText(Math.min(...row.series.map((p) => p.value)))} to ${pmText(max)} ${unit}; dashed line: WHO 24-hour guideline (${WHO_PM25_24H_UGM3} ${unit}).`;
  const nowX = x(anchorISO);
  const whoY = y(WHO_PM25_24H_UGM3);
  return (
    <svg className="anx-spark" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line className="anx-spark__who" x1={0} x2={W} y1={whoY} y2={whoY} />
      <line className="anx-spark__now" x1={nowX} x2={nowX} y1={0} y2={Hh} />
      {past.length > 1 && <path className="anx-spark__past" d={path(past)} />}
      {future.length > 1 && <path className="anx-spark__future" d={path(future)} />}
    </svg>
  );
}

/** "Thu 15 Oct, 4:00 pm local" → "Thu 15, 4 pm"; a UTC fallback keeps its "UTC". The full label goes in the title. */
function compactTime(label: string): string {
  const m = /^(\w{3}) (\d{1,2}) \w{3}, (\d{1,2})(?::(\d{2}))? (am|pm) local$/.exec(label);
  if (m) return `${m[1]} ${m[2]}, ${m[3]}${m[4] && m[4] !== '00' ? `:${m[4]}` : ''} ${m[5]}`;
  return label.replace(/^(\w{3}) (\d{1,2}) \w{3}, /, '$1 $2, ');
}

/** The band swatch beside a value; the band's name is written out in the row's place cell (never colour alone). */
function BandSwatch({ band }: { band: CityHazeRow['nowBand'] }) {
  if (!band) return null;
  return <span className={`anx-band__swatch anx-band__swatch--${band.key}`} title={band.label} aria-hidden="true" />;
}

function TransportBlock({ t, onFlyTo }: { t: TransportSummary; onFlyTo?: (lat: number, lon: number) => void }) {
  return (
    <>
      <p>
        <strong>{t.level}</strong> <span className="an-muted">({t.dataMode === 'live' ? 'live run' : `snapshot captured ${utcStamp(t.retrievedAt)}`})</span>:{' '}
        {t.sentence}
      </p>
      <div className="an-table-wrap">
        <table className="an-table">
          <caption>
            Forward {HAZE_FUTURE_H} h paths at {t.level} from {utcStamp(t.startISO)}, one per fire cluster (MODELLED, illustrative).
          </caption>
          <thead>
            <tr>
              <th scope="col">Fire cluster</th>
              <th scope="col" className="an-num">
                Hotspots
              </th>
              <th scope="col" className="an-num">
                FRP (MW)
              </th>
              <th scope="col">Reaches Singapore</th>
              <th scope="col" className="an-num">
                Closest
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.sourceId}>
                <td>
                  {onFlyTo ? (
                    <button type="button" className="an-row-btn" onClick={() => onFlyTo(r.lat, r.lon)} title="Fly the map to this cluster">
                      {r.label}
                    </button>
                  ) : (
                    r.label
                  )}
                  <span className="anx-sub">
                    {Math.abs(r.lat).toFixed(2)}°{r.lat >= 0 ? 'N' : 'S'} {r.lon.toFixed(2)}°E
                    {r.endReason !== 'complete' && ` · stopped after ${Math.round(r.hours)} h (${r.endReason === 'grid-edge' ? 'left the wind grid' : 'end of wind data'})`}
                  </span>
                </td>
                <td className="an-num">{r.hotspots.toLocaleString('en-US')}</td>
                <td className="an-num">{Math.round(r.frpSumMW).toLocaleString('en-US')}</td>
                <td>{r.reaches ? `Yes, after about ${Math.round(r.arrivalHours ?? r.hoursToClosest)} h` : 'No'}</td>
                <td className="an-num">
                  {r.closestKm.toLocaleString('en-US')} km
                  <span className="anx-sub">after {Math.round(r.hoursToClosest)} h</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export default function HazeAirSection({
  airQuality,
  nea,
  neaError = null,
  neaLoading = false,
  wind10m = null,
  wind925 = null,
  hazeSources = null,
  hotspotSnapshot = null,
  fires = null,
  transportStartISO = null,
  scrubberISO = null,
  selectedCityId = null,
  onFlyTo,
  onSelectCity,
}: HazeAirSectionProps) {
  const [sortKey, setSortKey] = useState<CitySortKey>('now');
  const [citiesOnly, setCitiesOnly] = useState(false);
  const table = useMemo(() => cityHazeTable(airQuality), [airQuality]);
  const anchorISO = useMemo(() => modelAnchorISO(airQuality), [airQuality]);
  const transports = useMemo(
    () => transportSummaries({ airQuality, wind10m, wind925, hazeSources, hotspotSnapshot, fires, transportStartISO }),
    [airQuality, wind10m, wind925, hazeSources, hotspotSnapshot, fires, transportStartISO],
  );
  const rows = useMemo(() => {
    if (!table) return [];
    const list = citiesOnly ? table.rows.filter((r) => r.kind === 'city') : table.rows;
    return sortCityRows(list, sortKey);
  }, [table, sortKey, citiesOnly]);

  const live = airQuality?.dataMode === 'live';
  const nowWord = live ? 'Now' : 'Snapshot hour';
  const sgPlace = airQuality?.places.find((p) => p.id === 'singapore') ?? null;
  const sgRow = table?.rows.find((r) => r.id === 'singapore') ?? null;
  const haze = nea?.haze ?? null;
  const modelAtReading = airQuality && sgPlace && haze ? placePm25At(airQuality, sgPlace, haze.observedAt) : null;
  const readingInRun =
    airQuality && haze
      ? Date.parse(haze.observedAt) >= Date.parse(airQuality.times[0]) && Date.parse(haze.observedAt) <= Date.parse(airQuality.times[airQuality.times.length - 1])
      : false;
  const worst = rows.length > 0 ? sortCityRows(rows, 'now')[0] : null;
  const showScrub = Boolean(airQuality && scrubberISO && anchorISO && Date.parse(scrubberISO) !== Date.parse(anchorISO) && Number.isFinite(Date.parse(scrubberISO)));
  const atScrub = (id: string): number | null => {
    const p = airQuality?.places.find((x) => x.id === id);
    return showScrub && p && airQuality && scrubberISO ? placePm25At(airQuality, p, scrubberISO) : null;
  };
  const overWho = table ? table.rows.filter((r) => (r.mean24hPast ?? -1) > WHO_PM25_24H_UGM3).length : 0;

  const sources: SectionSource[] = [];
  if (airQuality) {
    sources.push({
      label: `${airQuality.model}, PM2.5, via ${airQuality.source}`,
      url: airQuality.sourceUrl,
      retrievedAt: airQuality.retrievedAt,
      mode: `MODELLED · ${live ? 'LIVE' : 'SNAPSHOT'}`,
      licence: airQuality.attribution,
    });
  }
  if (nea) {
    sources.push({
      label: `${nea.sourceName}: PSI and PM2.5`,
      url: nea.sourceUrl,
      retrievedAt: haze?.observedAt ?? nea.observedAt,
      mode: `MEASURED · ${(haze?.dataMode ?? nea.dataMode) === 'live' ? 'LIVE' : 'SNAPSHOT'}`,
      licence: nea.attribution,
    });
  }
  for (const g of [wind925, wind10m]) {
    if (g) {
      sources.push({
        label: `${g.source}, wind at ${g.level}`,
        url: g.sourceUrl,
        retrievedAt: g.retrievedAt,
        mode: `MODELLED · ${g.dataMode === 'live' ? 'LIVE' : 'SNAPSHOT'}`,
        licence: g.attribution,
      });
    }
  }
  if (hotspotSnapshot) {
    sources.push({
      label: 'NASA FIRMS active fire hotspots (fire clusters for the paths)',
      url: FIRMS_PAGE,
      retrievedAt: hotspotSnapshot.satelliteAsOf ?? hotspotSnapshot.retrievedAt,
      mode: 'MEASURED · SNAPSHOT',
      licence: 'NASA open data; FIRMS acknowledgement in Sources & methods.',
    });
  }
  sources.push({ label: `${ASMC.name} (linked, not ingested)`, url: ASMC.alerts, mode: 'OFFICIAL · LINK ONLY' });
  sources.push({ label: `${NUS_CRISP.name} (linked)`, url: NUS_CRISP.url, mode: 'IMAGERY · LINK ONLY' });

  return (
    <AnalystSection
      id="ws-haze"
      title="Haze & air"
      meta={
        airQuality ? (
          <FreshnessChip freshness={live ? 'LIVE' : 'SNAPSHOT'} chip={`${live ? 'LIVE' : 'SNAPSHOT'} · run ${utcStamp(airQuality.retrievedAt)}`} />
        ) : (
          <FreshnessChip freshness="UNAVAILABLE" chip="NO MODEL DATA" />
        )
      }
      lede={
        <>
          How much fine smoke the forecast model puts over each tracked place, how that compares with what Singapore's
          monitors measure, and whether modelled winds carry air from the fire clusters toward Singapore. Model values are
          labelled MODELLED; they are context for a report, not observations and not an official air-quality index.
        </>
      }
      sources={sources}
    >
      {table && anchorISO ? (
        <>
          <div className="an-figures">
            {worst && (
              <KeyFigure
                label={`Worst, ${nowWord.toLowerCase()}`}
                value={pmText(worst.now)}
                unit="µg/m³"
                note={`${worst.name} · MODELLED`}
              />
            )}
            <KeyFigure
              label="Over the WHO 24 h guideline"
              value={table.covers24hPast ? `${overWho} of ${table.rows.length}` : '—'}
              note={`24 h mean above ${WHO_PM25_24H_UGM3} µg/m³ · MODELLED`}
            />
            {sgRow && <KeyFigure label={`Singapore, ${nowWord.toLowerCase()}`} value={pmText(sgRow.now)} unit="µg/m³" note="MODELLED" />}
            {haze && (
              <KeyFigure
                label="Singapore 24 h PSI"
                value={String(Math.max(...Object.values(haze.psi24h)))}
                note={`${haze.psiBand} (NEA) · MEASURED`}
              />
            )}
          </div>

          <AnalystSubhead>Every tracked place</AnalystSubhead>
          <p className="an-muted">
            Model hour {utcStamp(anchorISO)} ({live ? 'the live run, fetched this session' : `the bundled snapshot run captured ${utcStamp(table.retrievedAt)}; not current conditions`}).
            Peaks use the run's {table.stepHours === 1 ? 'hourly' : `${table.stepHours}-hourly`} values to {utcStamp(table.forecastEndISO)}
            {table.covers48h ? '' : `, which is short of +${HAZE_FUTURE_H} h`}. "× WHO" is the 24 h mean up to the model hour divided by the WHO
            24-hour guideline of {WHO_PM25_24H_UGM3} µg/m³. Towns marked as fire areas sit in peatland districts with recurrent fires.
          </p>
          <div className="anx-toolbar" role="group" aria-label="Sort the place table">
            <span>Sort:</span>
            {SORTS.map((s) => (
              <button key={s.key} type="button" className="anx-sort" aria-pressed={sortKey === s.key} onClick={() => setSortKey(s.key)}>
                {s.key === 'now' && !live ? 'Worst at snapshot hour' : s.label}
              </button>
            ))}
            <label>
              <input type="checkbox" checked={citiesOnly} onChange={(e) => setCitiesOnly(e.target.checked)} />
              Cities only
            </label>
          </div>
          <div className="an-table-wrap">
            <table className="an-table">
              <caption>
                Modelled PM2.5 (CAMS, µg/m³). Bands are US EPA-style concentration bands applied to model values, not an official
                index. <BasisTag basis="MODELLED" />
              </caption>
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th
                    scope="col"
                    className="an-num"
                    aria-sort={sortKey === 'now' ? 'descending' : undefined}
                    title={live ? 'The model hour of the live run' : "The snapshot run's model hour (not current conditions)"}
                  >
                    {live ? 'Now' : 'Snapshot'}
                  </th>
                  {showScrub && scrubberISO && (
                    <th scope="col" className="an-num" title={`Value at the map's time scrubber: ${utcStamp(scrubberISO)}`}>
                      Scrubber
                      <span className="anx-sub">{utcStamp(scrubberISO).slice(5, 16).replace('-', '/')}</span>
                    </th>
                  )}
                  <th scope="col" className="an-num">
                    24 h peak
                  </th>
                  <th scope="col" className="an-num" aria-sort={sortKey === 'peak48h' ? 'descending' : undefined}>
                    {HAZE_FUTURE_H} h peak
                  </th>
                  <th scope="col" className="an-num" aria-sort={sortKey === 'mean24h' ? 'descending' : undefined}>
                    × WHO
                  </th>
                  <th scope="col">72 h</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.id === selectedCityId ? 'anx-row--selected' : undefined}>
                    <th scope="row" className="anx-rowhead">
                      {onSelectCity || onFlyTo ? (
                        <button
                          type="button"
                          className="an-row-btn"
                          onClick={() => {
                            onSelectCity?.(r.id);
                            onFlyTo?.(r.lat, r.lon);
                          }}
                          title="Show this place on the map"
                        >
                          {r.name}
                        </button>
                      ) : (
                        r.name
                      )}
                      <span className="anx-sub anx-sub--wrap">
                        {COUNTRY_NAME[r.country] ?? r.country}
                        {r.kind === 'fire-area' ? ' · fire area' : ''}
                        {r.nowBand ? ` · ${r.nowBand.label}` : ''}
                        {r.trend ? ` · ${r.trend}` : ''}
                      </span>
                    </th>
                    <td className="an-num">
                      <span className="anx-band">
                        <BandSwatch band={r.nowBand} />
                        {pmText(r.now)}
                      </span>
                    </td>
                    {showScrub && <td className="an-num">{pmText(atScrub(r.id))}</td>}
                    <td className="an-num">
                      {pmText(r.peak24h.value)}
                      <span className="anx-sub" title={r.peak24h.localLabel}>
                        {compactTime(r.peak24h.shortLocal)}
                      </span>
                    </td>
                    <td className="an-num">
                      {pmText(r.peak48h.value)}
                      <span className="anx-sub" title={r.peak48h.localLabel}>
                        {compactTime(r.peak48h.shortLocal)}
                      </span>
                    </td>
                    <td className="an-num">
                      {whoMultipleText(r.mean24hPast)}
                      <span className="anx-sub">mean {pmText(r.mean24hPast)}</span>
                    </td>
                    <td>
                      <Sparkline row={r} anchorISO={table.anchorISO} unit="µg/m³" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="an-note">{PM25_BANDS_NOTE}</p>
        </>
      ) : (
        <p className="an-note">
          The air-quality model (CAMS PM2.5 via Open-Meteo) is not loaded, neither live nor from the bundled snapshot, so no
          modelled values are shown. This is not an all-clear: check ASMC and the national air-quality agencies below.
        </p>
      )}

      <AnalystSubhead>Singapore: measured by NEA, beside the model</AnalystSubhead>
      {haze ? (
        <>
          <p>
            NEA's readings ({(haze.dataMode ?? nea?.dataMode) === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT'}, reading time {utcStamp(haze.observedAt)}) are
            measurements from Singapore's own stations. <BasisTag basis="MEASURED" /> NEA's band for the highest region is "
            {haze.psiBand}".
          </p>
          <div className="an-table-wrap">
            <table className="an-table">
              <caption>NEA 24-hour PSI and 1-hour PM2.5 by region, as published (MEASURED).</caption>
              <thead>
                <tr>
                  <th scope="col">Region</th>
                  <th scope="col" className="an-num">
                    24-hour PSI
                  </th>
                  <th scope="col" className="an-num">
                    1-hour PM2.5 (µg/m³)
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(haze.psi24h).map(([region, psi]) => (
                  <tr key={region}>
                    <th scope="row" className="anx-rowhead anx-cap">
                      {region}
                    </th>
                    <td className="an-num">{psi}</td>
                    <td className="an-num">{haze.pm25OneHour?.[region] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {modelAtReading !== null && Number.isFinite(modelAtReading) && (
            <p>
              The model gives {pmText(modelAtReading)} µg/m³ for Singapore at NEA's reading hour
              {readingInRun ? '' : ' (that hour is outside the model run, so the nearest run value is used)'}
              {sgRow ? `, and ${pmText(sgRow.now)} µg/m³ at the model hour ${utcStamp(table?.anchorISO ?? null)}` : ''}.{' '}
              <BasisTag basis="MODELLED" />
            </p>
          )}
        </>
      ) : neaLoading ? (
        <p className="an-muted">Loading NEA readings…</p>
      ) : (
        <p className="an-note">
          NEA readings are not available{neaError ? ` (${neaError})` : ''}. Check <ExtLink href="https://www.haze.gov.sg/">NEA's haze site</ExtLink>{' '}
          directly; this is not an all-clear.
        </p>
      )}
      <details className="anx-details">
        <summary>Why the measured and modelled values differ</summary>
        <div className="anx-details__body">
          <p>
            <strong>Different quantities.</strong> PSI is NEA's 24-hour index across several pollutants, not a concentration;
            NEA's PM2.5 is a 1-hour concentration per region. The model value is an hourly PM2.5 concentration.
          </p>
          <p>
            <strong>Point against area.</strong> A monitor measures the air at its inlet. The model value is the average over a
            grid cell of about 45 km, so a plume narrower than a cell is diluted, and one nearby can be smeared in.
          </p>
          <p>
            <strong>Fire emissions.</strong> The model's smoke comes from satellite fire observations. Peat fires that smoulder
            below the surface, or burn under cloud and thick smoke, can be missed or underestimated; the assumed emissions and
            smoke height can also be off in the other direction.
          </p>
          <p>
            <strong>No local measurements.</strong> The model does not take in NEA's station readings, so it is not corrected
            toward them. Times differ too: NEA's reading time and the model hour are not the same hour.
          </p>
          <p>
            For what is in Singapore's air, use NEA's measurements. For health advice, follow{' '}
            <ExtLink href="https://www.haze.gov.sg/">NEA's haze advisories</ExtLink>.
          </p>
        </div>
      </details>

      <AnalystSubhead>Smoke transport toward Singapore</AnalystSubhead>
      {transports.length > 0 ? (
        <>
          <p className="an-muted">
            Forward paths through the modelled wind from each fire cluster, checked against Singapore. Two levels are shown
            because smoke rides at different heights: 925 hPa (about 750 m, the regional transport level the wind particles
            show) and 10 m (the surface, which the map's haze paths use). When they disagree, treat the direction as uncertain.
          </p>
          {transports.map((t) => (
            <TransportBlock key={t.level} t={t} onFlyTo={onFlyTo} />
          ))}
          <ul className="anx-list">
            {transports[0].caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="an-note">
          No transport is computed: {wind10m || wind925 ? 'no fire clusters are loaded to start paths from' : 'no modelled wind grid is loaded'}. This
          says nothing about whether smoke is reaching Singapore; use NEA's measurements.
        </p>
      )}

      <AnalystSubhead>The regional authority: ASMC</AnalystSubhead>
      <p>
        The {ASMC.name}, hosted by the Meteorological Service Singapore, is the ASEAN centre for transboundary haze. It
        publishes the daily regional haze situation, hotspot maps and counts from NOAA satellites, and a transboundary haze
        alert level, from Level 0 to Level 3, for parts of the region such as the southern ASEAN region and the Mekong
        sub-region. Quote ASMC's current alert level in a report: ASEAN Watch does not issue one.
      </p>
      <ul className="anx-links">
        <li>
          <ExtLink href={ASMC.home}>ASMC home: latest weather and haze situation, and the current alert banner</ExtLink>
        </li>
        <li>
          <ExtLink href={ASMC.alerts}>Warnings and alerts: alert levels, their definitions and every activation</ExtLink>
        </li>
        <li>
          <ExtLink href={ASMC.hotspots}>Hotspot information: distribution map</ExtLink> and{' '}
          <ExtLink href={ASMC.hotspotsDaily}>daily hotspot counts</ExtLink>
        </li>
        <li>
          <ExtLink href={ASMC.hazeReview}>Haze reviews: monthly reviews of the regional haze situation</ExtLink>
        </li>
        <li>
          <ExtLink href={ASMC.satellite}>Satellite images (polar-orbiting)</ExtLink> and the{' '}
          <ExtLink href={ASMC.wis2Haze}>WIS2 portal's regional haze map</ExtLink>
        </li>
      </ul>
      <p className="an-note">
        ASMC's alert level and haze text are not copied into ASEAN Watch. Its site has no open feed that a browser on another
        site may call, and its terms of use require written permission from the Meteorological Service Singapore to republish
        its content. The links above were checked on {ASMC.checkedAt}.
      </p>

      <AnalystSubhead>Satellite imagery: NUS CRISP</AnalystSubhead>
      <p>
        The <ExtLink href={NUS_CRISP.url}>{NUS_CRISP.name}</ExtLink> publishes satellite imagery of the region; Sentinel Asia
        lists its hotspot maps for Sumatra, Kalimantan and Malaysia. The site answered our automated check on 15 Oct 2026 with
        a security check, so its current pages were not verified here; open it in a browser.
        In this app, the Satellite chip shows NASA GIBS true colour and Himawari infrared for orientation.
      </p>

      <AnalystSubhead>National air-quality agencies</AnalystSubhead>
      <p className="an-muted">Official readings and health advice come from these agencies, not from ASEAN Watch.</p>
      <ul className="anx-links">
        {Object.entries(AIR_QUALITY_OFFICIAL).map(([cc, link]) => (
          <li key={cc}>
            {COUNTRY_NAME[cc] ?? cc}: <ExtLink href={link.url}>{link.label}</ExtLink>
          </li>
        ))}
      </ul>

      <details className="anx-details">
        <summary>Methods: what CAMS PM2.5 is, and how this section uses it</summary>
        <div className="anx-details__body">
          <p>
            <strong>The model.</strong> The Copernicus Atmosphere Monitoring Service (CAMS), run by ECMWF for the European
            Union's Copernicus programme, forecasts the composition of the atmosphere worldwide, including fine particles
            (PM2.5), several days ahead. Smoke enters the model through fire emissions estimated from satellite observations
            of fire radiative power.
          </p>
          <p>
            <strong>Resolution.</strong> The global forecast runs on a grid of about 45 km. A city's value is the model's
            value at that point, which is an area average; it cannot resolve a single plume, a valley or a street.
          </p>
          <p>
            <strong>How we fetch it.</strong> Open-Meteo's Air Quality API serves hourly PM2.5 (CC BY 4.0) for a 1° grid and the
            {airQuality ? ` ${airQuality.places.length}` : ''} tracked places, one day back and three days ahead. A live run is
            cached for 30 minutes; the bundled snapshot keeps every third hour.
          </p>
          <p>
            <strong>The model hour.</strong> "{nowWord}" is the 3-hourly step at the run's {live ? 'retrieval' : 'capture'} time, the
            same hour the map's time scrubber starts on.
          </p>
          <p>
            <strong>Bands and the WHO guideline.</strong> {PM25_BANDS_NOTE} The WHO 2021 guideline for PM2.5 is a 24-hour mean of{' '}
            {WHO_PM25_24H_UGM3} µg/m³, so "× WHO" compares the modelled 24-hour mean, not a single hour.
          </p>
          <p>
            <strong>Very high values.</strong> Near large peat fires the model can reach thousands of µg/m³. Read such values as a
            sign of a strong smoke source in the model, to be checked against monitors and ASMC's assessment, not as a measured
            concentration.
          </p>
        </div>
      </details>
    </AnalystSection>
  );
}
