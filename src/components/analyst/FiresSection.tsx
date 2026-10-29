// Analyst workspace: Fires (docs/UX_V3.md section 3.3), in the style of Copernicus Fire Emissions Watch but
// built on NASA FIRMS detections and fire radiative power (FRP), never emissions. Dense and wordy on purpose,
// for people writing reports: key figures, a situation paragraph, tables by country and by Indonesian
// province (and Malaysian state) with 7-day bars, top clusters with "Fly to", week-over-week change, the
// sensor mix, methods and caveats, link-outs and every source with the FIRMS acknowledgement.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AnalystSection, AnalystSubhead, KeyFigure, MiniBars } from './AnalystSection';
import {
  FIRE_LINKS,
  FIRMS_ACKNOWLEDGEMENT,
  FRP_NOT_EMISSIONS,
  NO_DETECTION_NOTE,
  SUMMED_FRP_NOTE,
  changeWords,
  clusterSentence,
  countryRollups,
  dailyValues,
  fireSourceRefs,
  formatCount,
  formatFireTime,
  formatMw,
  formatPct,
  regionRollups,
  sensorMix,
  smokeHeading,
  topClusters,
  weekOverWeek,
} from '../../lib/fires';
import type { FireCluster, FireClusterWindow, FireRollup, FireSeries, FireSnapshot, SmokeHeading, SmokePlace } from '../../lib/fires';
import type { WindGrid } from '../../lib/windField';
import './FiresSection.css';

export interface FiresSectionProps {
  /** Usually loadFireSnapshot(). Null shows an "unavailable" notice, never "no fires". */
  snapshot: FireSnapshot | null;
  /** Fly the map to a place: clusters use zoom 8, provinces 6.5, countries 5. */
  onFlyTo: (lat: number, lon: number, zoom?: number) => void;
  /** 925 hPa wind grid (loadWindField({ level: '925hPa' })) to add a MODELLED smoke heading per cluster. */
  windGrid?: WindGrid | null;
  /** Start time for the smoke paths (e.g. the scrubber time); defaults to the wind grid's retrieval hour. */
  smokeStartISO?: string;
  smokePlaces?: readonly SmokePlace[];
  /** Highlights the row of a cluster selected on the map. */
  selectedClusterId?: string | null;
  /** Called with the cluster when its "Fly to" is pressed (after onFlyTo), e.g. to select it on the map. */
  onSelectCluster?: (cluster: FireCluster) => void;
  /** Section element id (default "fires"). */
  id?: string;
}

const CLUSTER_ZOOM = 8;
const REGION_ZOOM = 6.5;
const COUNTRY_ZOOM = 5;

function Spark({ s, series, name }: { s: FireSnapshot; series: FireSeries; name: string }) {
  const days = dailyValues(s, series);
  return (
    <div className="fires-spark">
      <MiniBars
        caption={`${name}: hotspots per 24 h, oldest first`}
        bars={days.map((d) => ({
          label: d.label,
          value: d.count,
          highlight: d.p === 0,
          title: `${name}, 24 h to ${formatFireTime(d.end)}: ${formatCount(d.count)} hotspots, ${formatMw(d.frp)} summed FRP${d.partial ? ' (period starts before the files’ coverage)' : ''}`,
        }))}
      />
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="fires-vh"> (opens in a new tab)</span>
    </a>
  );
}

function RollupTable({
  s,
  rows,
  caption,
  nameHeader,
  zoom,
  onFlyTo,
}: {
  s: FireSnapshot;
  rows: readonly FireRollup[];
  caption: string;
  nameHeader: string;
  zoom: number;
  onFlyTo: FiresSectionProps['onFlyTo'];
}) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{nameHeader}</th>
            <th scope="col" className="an-num">
              Hotspots 24 h
            </th>
            <th scope="col" className="an-num">
              FRP 24 h (MW)
            </th>
            <th scope="col" className="an-num">
              FRP vs prev. 24 h
            </th>
            <th scope="col" className="an-num">
              Hotspots 7 d
            </th>
            <th scope="col">7 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const centre = r.centre24h ?? r.centre7d;
            return (
              <tr key={r.key}>
                <th scope="row">
                  {centre && r.kind !== 'unassigned' ? (
                    <button type="button" className="an-row-btn" onClick={() => onFlyTo(centre[0], centre[1], zoom)} title={`Fly to ${r.name}`}>
                      {r.name}
                    </button>
                  ) : (
                    r.name
                  )}
                  {r.kind === 'country' && !r.asean && <span className="an-tag">non-ASEAN</span>}
                </th>
                <td className="an-num">{formatCount(r.last24h.count)}</td>
                <td className="an-num">{formatMw(r.last24h.frp).replace(/ MW$/, '')}</td>
                <td className="an-num">{formatPct(r.frpChange24hPct)}</td>
                <td className="an-num">{formatCount(r.last7d.count)}</td>
                <td className="fires-spark-cell">
                  <Spark s={s} series={r.series} name={r.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Unavailable({ id }: { id: string }) {
  return (
    <AnalystSection
      id={id}
      title="Fires"
      meta="MEASURED · FIRMS"
      lede="The bundled fire snapshot is missing or could not be read."
      sources={[{ label: 'NASA FIRMS fire map', url: FIRE_LINKS.firmsMap, mode: 'LINK' }]}
    >
      <p className="an-note">
        Fire data unavailable here. This is not an all-clear: check <ExtLink href={FIRE_LINKS.firmsMap}>NASA FIRMS</ExtLink> and{' '}
        <ExtLink href={FIRE_LINKS.fireEmissionsWatch}>Copernicus Fire Emissions Watch</ExtLink> directly.
      </p>
    </AnalystSection>
  );
}

export function FiresSection(props: FiresSectionProps) {
  const { snapshot: s, onFlyTo, windGrid, smokeStartISO, smokePlaces, selectedClusterId, onSelectCluster } = props;
  const id = props.id ?? 'fires';
  const [clusterWindow, setClusterWindow] = useState<FireClusterWindow>('24h');

  const clusters = useMemo(() => (s ? topClusters(s, clusterWindow, 15) : []), [s, clusterWindow]);
  const headings = useMemo(() => {
    const m = new Map<string, SmokeHeading | null>();
    if (windGrid) for (const c of clusters) m.set(c.id, smokeHeading(c, windGrid, { startISO: smokeStartISO, places: smokePlaces }));
    return m;
  }, [clusters, windGrid, smokeStartISO, smokePlaces]);

  if (!s) return <Unavailable id={id} />;

  const t = s.totals;
  const countries = countryRollups(s, { includeUnassigned: true });
  const idnRegions = regionRollups(s, 'IDN');
  const mysRegions = regionRollups(s, 'MYS');
  const idn = s.countries.find((c) => c.iso3 === 'IDN');
  const asean24 = s.countries.filter((c) => c.asean).reduce((n, c) => n + c.last24h.count, 0);
  const lead24 = topClusters(s, '24h', 1)[0];
  const countriesWithFires = s.countries.filter((c) => c.kind === 'country' && c.last24h.count > 0).length;
  const wowAll = weekOverWeek(s);
  const wowIdn = weekOverWeek(s, { key: 'IDN' });
  const mix24 = sensorMix(t.series, '24h');
  const mix7 = sensorMix(t.series, '7d');
  const ref = formatFireTime(s.reference);
  const topProvinces = idnRegions.slice(0, 3);
  const share = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : 'n/a');

  const situation =
    `In the 24 h to ${ref}, NASA FIRMS recorded ${formatCount(t.last24h.count)} confident hotspots across its South East Asia region ` +
    `(${formatMw(t.last24h.frp)} summed FRP); ${changeWords(t.frpChange24hPct, t.last24h.frp, t.prev24h.frp, 'the 24 h before')}. ` +
    (idn
      ? `Indonesia had ${formatCount(idn.last24h.count)} (${share(idn.last24h.count, t.last24h.count)} of the region)` +
        (topProvinces.length ? `, mostly in ${topProvinces.map((r) => `${r.name} (${formatCount(r.last24h.count)})`).join(', ')}` : '') +
        '. '
      : '') +
    `ASEAN members together had ${formatCount(asean24)}. ` +
    (lead24 ? `The strongest cluster by fire power: ${clusterSentence(lead24)}` : NO_DETECTION_NOTE);

  return (
    <AnalystSection
      id={id}
      title="Fires"
      meta={
        <>
          <span className="an-tag">MEASURED</span> FIRMS · 24 h to {ref}
        </>
      }
      lede={
        <>
          Active-fire detections from NASA FIRMS (VIIRS on Suomi NPP, NOAA-20 and NOAA-21, and MODIS), summed by country,
          province and cluster in the style of Copernicus Fire Emissions Watch. Figures are hotspot counts and fire radiative
          power (FRP), a proxy for fire intensity, not emissions; for emissions see{' '}
          <ExtLink href={FIRE_LINKS.fireEmissionsWatch}>Fire Emissions Watch</ExtLink>. {s.origin === 'live' ? 'Fetched' : 'Snapshot retrieved'} {formatFireTime(s.retrievedAt)}.
        </>
      }
      sources={fireSourceRefs(s)}
    >
      <div className="fires-body">
      <div className="an-figures">
        <KeyFigure label="Hotspots, last 24 h" value={formatCount(t.last24h.count)} note={`${formatPct(t.countChange24hPct)} vs previous 24 h`} />
        <KeyFigure label="Fire power, last 24 h" value={formatMw(t.last24h.frp).replace(/ MW$/, '')} unit="MW" note={`summed FRP · ${formatPct(t.frpChange24hPct)}`} />
        <KeyFigure label="Hotspots, 7 days" value={formatCount(t.last7d.count)} note={`${formatMw(t.last7d.frp)} summed FRP`} />
        <KeyFigure label="Indonesia, last 24 h" value={idn ? formatCount(idn.last24h.count) : '0'} note={idn ? `${share(idn.last24h.count, t.last24h.count)} of the region` : 'no detections'} />
        <KeyFigure label="Countries with hotspots" value={String(countriesWithFires)} note="last 24 h" />
        <KeyFigure label="Strongest single detection" value={formatMw(t.series.frpMax[0]).replace(/ MW$/, '')} unit="MW" note="last 24 h" />
      </div>

      <p>{situation}</p>
      <Spark s={s} series={t.series} name="Whole FIRMS South East Asia region" />

      <AnalystSubhead>By country</AnalystSubhead>
      <RollupTable
        s={s}
        rows={countries}
        nameHeader="Country"
        zoom={COUNTRY_ZOOM}
        onFlyTo={onFlyTo}
        caption={
          'Point in polygon against Natural Earth boundaries; detections up to about 15 km off a coastline count for that country. ' +
          '"Outside country boundaries" is sea, offshore platforms or islands missing from the boundary data. Sorted by 7-day FRP.'
        }
      />

      <AnalystSubhead>By Indonesian province (approximate)</AnalystSubhead>
      {idnRegions.length ? (
        <RollupTable
          s={s}
          rows={idnRegions}
          nameHeader="Province"
          zoom={REGION_ZOOM}
          onFlyTo={onFlyTo}
          caption={
            'Each detection takes the province of the nearest regency or city centre (geoBoundaries), so detections near a provincial ' +
            'boundary can be counted next door. Provinces follow the 2022 Papua split. Sorted by 7-day FRP.'
          }
        />
      ) : (
        <p className="an-note">No confident detections in Indonesia in this snapshot. {NO_DETECTION_NOTE}</p>
      )}

      {mysRegions.length > 0 && (
        <>
          <AnalystSubhead>By Malaysian state (approximate)</AnalystSubhead>
          <RollupTable
            s={s}
            rows={mysRegions}
            nameHeader="State"
            zoom={REGION_ZOOM}
            onFlyTo={onFlyTo}
            caption="Each detection takes the state of the nearest district centre (geoBoundaries). Approximate near boundaries."
          />
        </>
      )}

      <AnalystSubhead>Top clusters</AnalystSubhead>
      <div className="fires-tabs" role="group" aria-label="Cluster window">
        {(['24h', '7d'] as const).map((w) => (
          <button key={w} type="button" className="fires-tab" aria-pressed={clusterWindow === w} onClick={() => setClusterWindow(w)}>
            {w === '24h' ? 'Last 24 h' : 'Last 7 days'}
          </button>
        ))}
      </div>
      {clusters.length ? (
        <>
          <ol className="fires-clusters" aria-label={`Top fire clusters, ${clusterWindow === '24h' ? 'last 24 h' : 'last 7 days'}`}>
            {clusters.map((c) => {
              const h = windGrid ? headings.get(c.id) : undefined;
              return (
                <li
                  key={c.id}
                  className={`fires-cluster${c.id === selectedClusterId ? ' fires-cluster--selected' : ''}`}
                  aria-current={c.id === selectedClusterId ? 'true' : undefined}
                >
                  <div className="fires-cluster__head">
                    <span className="fires-cluster__rank">{c.rank}</span>
                    <span className="fires-name">
                      {c.name}
                      {!c.name.includes(c.place.country) && <span className="an-muted"> · {c.place.country}</span>}
                    </span>
                    <button
                      type="button"
                      className="an-row-btn fires-fly"
                      onClick={() => {
                        onFlyTo(c.lat, c.lon, CLUSTER_ZOOM);
                        onSelectCluster?.(c);
                      }}
                    >
                      Fly to <span aria-hidden="true">→</span>
                      <span className="fires-vh"> {c.name}</span>
                    </button>
                  </div>
                  <div className="fires-cluster__figs">
                    <span>
                      <b>{formatCount(c.last24h.count)}</b> hotspots, 24 h
                    </span>
                    <span>
                      <b>{formatMw(c.last24h.frp)}</b> FRP
                    </span>
                    <span>
                      <b>{formatPct(c.frpChange24hPct)}</b> vs prev. 24 h
                    </span>
                    {c.window === '7d' && (
                      <span>
                        <b>{formatCount(c.last7d.count)}</b> in 7 days
                      </span>
                    )}
                    <span className="fires-spark-cell">
                      <Spark s={s} series={c.series} name={c.name} />
                    </span>
                  </div>
                  <p className="fires-sub">{clusterSentence(c)}</p>
                  {windGrid && (
                    <p className="fires-sub">
                      <span className="an-tag fires-tag--modelled">MODELLED</span> {h ? h.sentence : 'Smoke heading not modelled here: the cluster is outside the 925 hPa wind grid (6°S to 8°N, 95°E to 120°E).'}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="an-muted fires-caption">
            Connected 0.25° cells with detections, large complexes split into pieces about 1.25° across, ranked by summed FRP over the
            window. Names come from the nearest regency, district or province centre (approximate).
            {windGrid ? ' Smoke heading: MODELLED 925 hPa wind, 24 h forward path from the cluster centre; not a dispersion model.' : ''}
          </p>
        </>
      ) : (
        <p className="an-note">No clusters in this window. {NO_DETECTION_NOTE}</p>
      )}

      <AnalystSubhead>Week over week</AnalystSubhead>
      <p>{wowAll.sentence}</p>
      {idn && <p>{wowIdn.sentence}</p>}
      <p className="an-muted">
        Week-over-week uses complete UTC days kept in the snapshot's history ({wowAll.daysAvailable} held
        {s.history.length ? `, ${s.history[0].date} to ${s.history[s.history.length - 1].date}` : ''}); the FIRMS open files cover only 7
        days, so the history grows by one day with each refresh. The 72-hour comparison uses the rolling 24-hour periods above.
      </p>

      <AnalystSubhead>Sensor mix</AnalystSubhead>
      <div className="an-table-wrap">
        <table className="an-table">
          <caption>
            Confident detections per sensor. One fire seen by several sensors counts once per sensor and pass. VIIRS sees smaller fires
            (375 m pixels) than MODIS (1 km). Each satellite passes over a point about twice a day: the VIIRS satellites and Aqua near
            13:30 and 01:30 local solar time, Terra near 10:30 and 22:30.
          </caption>
          <thead>
            <tr>
              <th scope="col">Sensor</th>
              <th scope="col" className="an-num">
                24 h
              </th>
              <th scope="col" className="an-num">
                Share
              </th>
              <th scope="col" className="an-num">
                7 days
              </th>
              <th scope="col" className="an-num">
                Share
              </th>
              <th scope="col">File last modified</th>
            </tr>
          </thead>
          <tbody>
            {mix24.map((m, i) => {
              const src = s.sources.find((x) => x.sensor === m.sensor);
              return (
                <tr key={m.sensor}>
                  <th scope="row">
                    {m.label}
                    {s.laggingSensors.includes(m.sensor) && <span className="an-tag">LAGGING</span>}
                  </th>
                  <td className="an-num">{formatCount(m.count)}</td>
                  <td className="an-num">{`${Math.round(m.share * 100)}%`}</td>
                  <td className="an-num">{formatCount(mix7[i].count)}</td>
                  <td className="an-num">{`${Math.round(mix7[i].share * 100)}%`}</td>
                  <td>{src?.lastModified ? formatFireTime(src.lastModified) : 'n/a'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AnalystSubhead>Methods and caveats</AnalystSubhead>
      <ul className="fires-methods">
        <li>
          <strong>FRP is not emissions.</strong> {FRP_NOT_EMISSIONS}
        </li>
        <li>
          <strong>Summed FRP double counts.</strong> {SUMMED_FRP_NOTE}
        </li>
        <li>
          <strong>Overpass timing.</strong> Satellites see a fire only when they pass, a few times a day. A fire that flares and dies
          between passes is missed, and counts swing with which passes fall in a period. Periods are rolling 24 h windows counted back
          from {ref}, the latest time all four sensors had delivered data (FIRMS near-real-time files arrive up to about 3 h after each
          pass), so each period holds the same passes. The oldest period starts before the files' coverage ({formatFireTime(s.coverageStart)})
          and may miss the tail of one night pass.
        </li>
        <li>
          <strong>Cloud and smoke hide fires.</strong> {NO_DETECTION_NOTE} Thick haze over a burning peatland can lower counts while
          the fire continues.
        </li>
        <li>
          <strong>Not every hotspot is a vegetation fire.</strong> FIRMS flags thermal anomalies: volcanoes, gas flares and industrial
          heat also appear.
        </li>
        <li>
          <strong>Confidence filter.</strong> Only VIIRS detections of {s.filters.viirs} and MODIS detections of {s.filters.modis} are
          counted, the same thresholds as the watch rules. Low-confidence detections are left out.
        </li>
        <li>
          <strong>Places are approximate.</strong> Countries come from Natural Earth polygons; provinces, states and cluster names from
          the nearest district or province centre (geoBoundaries).
        </li>
        <li>
          {s.origin === 'live' ? (
            <>
              <strong>Live, rebuilt every few hours.</strong> FIRMS sends no CORS headers, so the browser cannot read its files; these
              figures come from the site's /api/fires relay, which reads them and was fetched {formatFireTime(s.retrievedAt)}.
            </>
          ) : (
            <>
              <strong>Saved copy, not live.</strong> The /api/fires relay has not answered, so these figures come from the bundled
              snapshot retrieved {formatFireTime(s.retrievedAt)}.
            </>
          )}
        </li>
      </ul>

      <AnalystSubhead>Go further</AnalystSubhead>
      <ul className="fires-links">
        <li>
          <ExtLink href={FIRE_LINKS.fireEmissionsWatch}>Open Copernicus Fire Emissions Watch</ExtLink>: daily wildfire emissions by
          country and region from CAMS GFAS, which converts FRP into emissions, with long-term context and smoke.
        </li>
        <li>
          <ExtLink href={FIRE_LINKS.crisp}>NUS CRISP satellite imagery</ExtLink>: the Centre for Remote Imaging, Sensing and Processing
          at the National University of Singapore publishes hotspot maps and satellite images of the region.
        </li>
        <li>
          <ExtLink href={FIRE_LINKS.firmsMap}>NASA FIRMS fire map</ExtLink>: every detection, live, with satellite imagery.
        </li>
        <li>
          <ExtLink href={FIRE_LINKS.gfas}>CAMS GFAS dataset</ExtLink> (Atmosphere Data Store): the emissions data behind Fire Emissions
          Watch.
        </li>
      </ul>
      <p className="an-note">{FIRMS_ACKNOWLEDGEMENT}</p>
      </div>
    </AnalystSection>
  );
}
