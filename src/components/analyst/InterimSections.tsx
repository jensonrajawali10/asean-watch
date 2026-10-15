// Interim Situation, Haze & air, Fires, Report and Sources sections. Real data, compact: each is replaced
// by the content and fires teammates' SituationSection, HazeAirSection, FiresSection, ReportSection and
// SourcesSection as they land (App swaps one import per section). Every number cites its source and mode.
import type { Incident, OfficialWarning, WarningFeedStatus, ConnectorStatus, HazeReading } from '../../types';
import type { AirQualityData } from '../../lib/airQuality';
import { WHO_PM25_24H_UGM3, describePm25, placePm25At, pm25Band } from '../../lib/airQuality';
import type { HotspotMember, RealFixtures, SnapshotSource } from '../../lib/fixtures';
import { localTimeLabel, placeRef, AIR_QUALITY_OFFICIAL } from '../../lib/places';
import type { HazeHour } from '../map/useHazeHour';
import type { OfficialVolcanoLevel } from '../map/volcanoLevels';
import { activeOfficial, isUrgentWarning } from '../shell/alerts';
import { ExternalLink, ModeBadge, OfficialLevelChip, OfficialTag } from '../Badges';
import { formatUtc } from '../format';
import BriefPanel from '../BriefPanel';
import type { BriefPanelProps } from '../BriefPanel';
import { AnalystSection, AnalystSubhead, KeyFigure, MiniBars } from './AnalystSection';
import type { MiniBar, SectionSource } from './AnalystSection';

const HOUR = 3_600_000;
const round0 = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------
// Shared derivations

export interface CityRow {
  id: string;
  name: string;
  country: string;
  now: number;
  peak: { value: number; timeISO: string } | null;
  timesWho: number | null;
  trend: 'rising' | 'falling' | 'steady' | null;
  band: string | null;
}

/** One row per place: value at the scrubber hour, the next-24 h peak, the WHO multiple and the 24 h trend. */
export function cityRows(aq: AirQualityData | null, hazeHour: HazeHour | null): CityRow[] {
  if (!aq || !hazeHour) return [];
  const t0 = Date.parse(hazeHour.timeISO);
  const times = aq.times.map((t) => Date.parse(t));
  return aq.places
    .map((p) => {
      const now = placePm25At(aq, p, hazeHour.timeISO);
      let peak: CityRow['peak'] = null;
      for (let k = 0; k < times.length; k += 1) {
        if (times[k] < t0 || times[k] > t0 + 24 * HOUR) continue;
        if (!peak || p.pm25[k] > peak.value) peak = { value: p.pm25[k], timeISO: aq.times[k] };
      }
      const later = placePm25At(aq, p, new Date(t0 + 24 * HOUR).toISOString().replace(/\.000Z$/, 'Z'));
      const trend: CityRow['trend'] = !Number.isFinite(later) ? null : later > now * 1.15 ? 'rising' : later < now * 0.85 ? 'falling' : 'steady';
      return {
        id: p.id,
        name: p.name,
        country: p.country,
        now,
        peak,
        timesWho: describePm25(now).timesWho,
        trend,
        band: pm25Band(now)?.label ?? null,
      };
    })
    .sort((a, b) => b.now - a.now);
}

export interface FireCounts {
  watchId: string;
  title: string;
  last24h: number;
  last7d: number;
  frp24h: number;
  frp7d: number;
  daily: MiniBar[];
}

/** Hotspots behind every watch's thermal records, by day, with FRP sums. From the bundled snapshot. */
export function fireCounts(fx: Pick<RealFixtures, 'observations' | 'members' | 'incidents' | 'snapshot'>): FireCounts[] {
  const end = Date.parse(fx.snapshot.retrievedAt) || Date.now();
  const out: FireCounts[] = [];
  for (const inc of fx.incidents) {
    const members: HotspotMember[] = fx.observations
      .filter((o) => o.incidentId === inc.id && o.category === 'thermal')
      .flatMap((o) => fx.members[o.id] ?? []);
    const seen = new Set<string>();
    const unique = members.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    const byDay = new Map<string, { n: number; frp: number }>();
    let last24h = 0;
    let frp24h = 0;
    let frp7d = 0;
    for (const m of unique) {
      const t = Date.parse(m.observedAt);
      const day = m.observedAt.slice(0, 10);
      const d = byDay.get(day) ?? { n: 0, frp: 0 };
      d.n += 1;
      d.frp += Number.isFinite(m.frp) ? m.frp : 0;
      byDay.set(day, d);
      frp7d += Number.isFinite(m.frp) ? m.frp : 0;
      if (end - t <= 24 * HOUR) {
        last24h += 1;
        frp24h += Number.isFinite(m.frp) ? m.frp : 0;
      }
    }
    const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    out.push({
      watchId: inc.id,
      title: inc.title,
      last24h,
      last7d: unique.length,
      frp24h,
      frp7d,
      daily: days.map(([day, d]) => ({ label: day.slice(8, 10), value: d.n, title: `${day}: ${d.n} hotspots, ${Math.round(d.frp)} MW` })),
    });
  }
  return out.sort((a, b) => b.last7d - a.last7d);
}

// ---------------------------------------------------------------------------------------------
// Situation

export interface SituationInterimProps {
  headline: string;
  airQuality: AirQualityData | null;
  hazeHour: HazeHour | null;
  warnings: OfficialWarning[];
  incidents: Incident[];
  placeNames: Record<string, string>;
  levels: Record<string, OfficialVolcanoLevel | null>;
  fires: FireCounts[];
  onInspectWarning: (id: string) => void;
  onOpenVolcano: (id: string) => void;
}

export function SituationInterim(p: SituationInterimProps) {
  const rows = cityRows(p.airQuality, p.hazeHour).slice(0, 5);
  const active = activeOfficial(p.warnings);
  const urgent = active.filter(isUrgentWarning);
  const biggestFire = p.fires[0] ?? null;
  const snapshot = p.airQuality?.dataMode === 'historical';
  const sources: SectionSource[] = [
    { label: 'CAMS PM2.5 via Open-Meteo', url: 'https://open-meteo.com/en/docs/air-quality-api', mode: snapshot ? 'SNAPSHOT' : 'LIVE', retrievedAt: p.airQuality?.retrievedAt ?? null, licence: 'CC BY 4.0' },
    { label: 'NASA FIRMS (bundled snapshot)', url: 'https://firms.modaps.eosdis.nasa.gov/', mode: 'SNAPSHOT' },
    { label: 'Official warning feeds (see the Warnings section)', mode: 'OFFICIAL' },
  ];
  return (
    <AnalystSection
      id="situation"
      title="Situation"
      lede="A deterministic situation summary from the data on screen. Modelled figures say so; official levels are the issuers' words. The content teammate's generated report replaces this interim version."
      sources={sources}
    >
      <p className="an-note">{p.headline}</p>
      <div className="an-figures">
        <KeyFigure label="Worst city (modelled)" value={rows[0] ? round0(rows[0].now) : '—'} unit="µg/m³" note={rows[0]?.name ?? 'no air-quality data'} />
        <KeyFigure label="Active official messages" value={String(active.length)} note={urgent.length > 0 ? `${urgent.length} tsunami or evacuation-level` : 'none tsunami or evacuation-level'} />
        <KeyFigure label="Biggest fire region (7 d)" value={biggestFire ? String(biggestFire.last7d) : '—'} unit="hotspots" note={biggestFire ? `${biggestFire.title}, ${Math.round(biggestFire.frp7d)} MW` : 'no snapshot'} />
        <KeyFigure label="Volcanoes at Level III+" value={String(Object.values(p.levels).filter((l) => l && (l.levelNumber ?? 0) >= 3).length)} note="official MAGMA level, verbatim" />
      </div>

      <AnalystSubhead>Worst cities at this hour (modelled)</AnalystSubhead>
      <div className="an-table-wrap">
        <table className="an-table">
          <caption>CAMS PM2.5 at the scrubber hour, {p.hazeHour ? formatUtc(p.hazeHour.timeISO) : ''}. Not an official index.</caption>
          <thead>
            <tr>
              <th>City</th>
              <th className="an-num">PM2.5</th>
              <th>Band</th>
              <th className="an-num">× WHO 24 h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="an-num mono">{round0(r.now)}</td>
                <td>{r.band ?? '—'}</td>
                <td className="an-num mono">{r.timesWho === null ? '—' : `${r.timesWho}×`}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="an-muted">
                  Air-quality data not loaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AnalystSubhead>Volcano levels (official, verbatim)</AnalystSubhead>
      <ul className="watch-rules">
        {p.incidents
          .filter((i) => i.hazard === 'volcano')
          .map((i) => {
            const level = p.levels[i.id];
            return (
              <li key={i.id}>
                <button type="button" className="an-row-btn" onClick={() => p.onOpenVolcano(i.id)}>
                  {p.placeNames[i.id] ?? i.title}
                </button>
                {level ? (
                  <>
                    {' '}
                    <OfficialLevelChip level={level.level} /> <span className="an-muted">{level.issuer}</span>
                  </>
                ) : (
                  <span className="an-muted"> · no official level on file; check PVMBG MAGMA directly</span>
                )}
              </li>
            );
          })}
      </ul>

      <AnalystSubhead>Official messages in force</AnalystSubhead>
      {active.length === 0 ? (
        <p className="an-muted">No active official message retrieved. This is not an all-clear.</p>
      ) : (
        <ul className="watch-rules">
          {active.slice(0, 6).map((w) => (
            <li key={w.id}>
              <OfficialTag issuer={w.issuer} authority="official" />{' '}
              <button type="button" className="an-row-btn" onClick={() => p.onInspectWarning(w.id)} lang={w.language || undefined}>
                {w.headline.trim().slice(0, 110)}
              </button>
            </li>
          ))}
          {active.length > 6 && <li className="an-muted">{active.length - 6} more in the Warnings section.</li>}
        </ul>
      )}
    </AnalystSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Haze & air

export interface HazeInterimProps {
  airQuality: AirQualityData | null;
  hazeHour: HazeHour | null;
  neaHaze: HazeReading | null;
  transportSummary: string | null;
  selectedCityId: string | null;
  onSelectCity: (id: string) => void;
}

export function HazeInterim(p: HazeInterimProps) {
  const rows = cityRows(p.airQuality, p.hazeHour);
  const snapshot = p.airQuality?.dataMode === 'historical';
  const psi = p.neaHaze ? Object.values(p.neaHaze.psi24h).filter((v) => Number.isFinite(v)) : [];
  const sources: SectionSource[] = [
    { label: 'CAMS global forecast via Open-Meteo Air Quality API', url: 'https://open-meteo.com/en/docs/air-quality-api', mode: snapshot ? 'SNAPSHOT' : 'LIVE', retrievedAt: p.airQuality?.retrievedAt ?? null, licence: 'CC BY 4.0' },
    { label: 'NEA Singapore PSI via data.gov.sg', url: 'https://data.gov.sg/', mode: p.neaHaze?.dataMode === 'historical' ? 'SNAPSHOT' : 'MEASURED', retrievedAt: p.neaHaze?.observedAt ?? null, licence: 'Singapore Open Data Licence' },
    { label: 'ASEAN Specialised Meteorological Centre (regional authority)', url: 'http://asmc.asean.org/', mode: 'OFFICIAL' },
    { label: 'NUS CRISP satellite imagery', url: 'https://crisp.nus.edu.sg/', mode: 'MEASURED' },
  ];
  return (
    <AnalystSection
      id="haze"
      title="Haze & air"
      lede={`Modelled PM2.5 for ${rows.length || 'the'} places from the CAMS forecast, against the WHO 24-hour guideline of ${WHO_PM25_24H_UGM3} µg/m³. Singapore's measured NEA PSI sits beside the model, labelled apart. The full table, charts and transport analysis arrive with the content teammate's section.`}
      meta={p.hazeHour ? `hour shown ${formatUtc(p.hazeHour.timeISO)}` : undefined}
      sources={sources}
    >
      {p.neaHaze && psi.length > 0 && (
        <div className="an-figures">
          <KeyFigure label="Singapore 24-h PSI (NEA, measured)" value={`${Math.min(...psi)}–${Math.max(...psi)}`} note={`${p.neaHaze.psiBand} · ${p.neaHaze.dataMode === 'historical' ? 'saved reading' : 'live'} ${formatUtc(p.neaHaze.observedAt)}`} />
          <KeyFigure label="Singapore PM2.5 (CAMS, modelled)" value={rows.find((r) => r.id === 'singapore') ? round0(rows.find((r) => r.id === 'singapore')!.now) : '—'} unit="µg/m³" note="model, about 45 km squares" />
        </div>
      )}
      {p.transportSummary && <p className="an-note">{p.transportSummary}</p>}
      <div className="an-table-wrap">
        <table className="an-table">
          <caption>MODELLED CAMS PM2.5 (µg/m³). Peak and trend over the 24 h after the hour shown. Rows are clickable: the map flies there.</caption>
          <thead>
            <tr>
              <th>Place</th>
              <th className="an-num">Now</th>
              <th className="an-num">24 h peak</th>
              <th>at (local)</th>
              <th className="an-num">× WHO</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} aria-current={r.id === p.selectedCityId ? 'true' : undefined}>
                <td>
                  <button type="button" className="an-row-btn" onClick={() => p.onSelectCity(r.id)}>
                    {r.name}
                  </button>
                </td>
                <td className="an-num mono">{round0(r.now)}</td>
                <td className="an-num mono">{r.peak ? round0(r.peak.value) : '—'}</td>
                <td className="mono">{r.peak ? localTimeLabel(r.peak.timeISO, placeRef(r), { utc: false }) : '—'}</td>
                <td className="an-num mono">{r.timesWho === null ? '—' : `${r.timesWho}×`}</td>
                <td>{r.trend ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="an-muted">
                  Air-quality data not loaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="an-muted">
        Official readings: {Object.entries(AIR_QUALITY_OFFICIAL).map(([cc, l], i) => (
          <span key={cc}>
            {i > 0 ? ' · ' : ''}
            <ExternalLink href={l.url}>{l.label}</ExternalLink>
          </span>
        ))}
      </p>
    </AnalystSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Fires

export interface FiresInterimProps {
  fires: FireCounts[];
  snapshotAt: string | null;
  onFlyTo: (watchId: string) => void;
}

export function FiresInterim(p: FiresInterimProps) {
  const sources: SectionSource[] = [
    { label: 'NASA FIRMS VIIRS 375 m (NOAA-20, NOAA-21, Suomi NPP) and MODIS, bundled snapshot', url: 'https://firms.modaps.eosdis.nasa.gov/', mode: 'SNAPSHOT', retrievedAt: p.snapshotAt },
  ];
  return (
    <AnalystSection
      id="fires"
      title="Fires"
      lede="Satellite hotspots behind each watch area's thermal records in the bundled seven-day snapshot, with their summed fire radiative power (FRP). FRP is a proxy for emissions; CAMS GFAS converts it to emissions. Detections are not confirmed fires, and cloud or smoke hides hotspots. The fires teammate's section adds region-wide counts and clusters."
      meta={p.snapshotAt ? `snapshot ${formatUtc(p.snapshotAt)}` : undefined}
      sources={sources}
    >
      {p.fires.length === 0 && <p className="an-muted">No hotspot snapshot loaded.</p>}
      {p.fires.map((f) => (
        <div key={f.watchId}>
          <AnalystSubhead>{f.title}</AnalystSubhead>
          <div className="an-figures">
            <KeyFigure label="Hotspots, last 24 h" value={String(f.last24h)} note={`${Math.round(f.frp24h)} MW summed FRP`} />
            <KeyFigure label="Hotspots, 7 days" value={String(f.last7d)} note={`${Math.round(f.frp7d)} MW summed FRP`} />
          </div>
          {f.daily.length > 0 && <MiniBars bars={f.daily} caption="Hotspots per UTC day (snapshot window)" />}
          <div className="ws-row-actions">
            <button type="button" className="btn" onClick={() => p.onFlyTo(f.watchId)}>
              Fly to {f.title}
            </button>
          </div>
        </div>
      ))}
    </AnalystSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Report

export interface ReportInterimProps {
  brief: BriefPanelProps | null;
  headline: string;
  onOpenVolcanoes: () => void;
}

export function ReportInterim(p: ReportInterimProps) {
  return (
    <AnalystSection
      id="report"
      title="Report"
      lede="The deterministic brief for the selected watch area and replay day, downloadable as .txt, plus the grounded Claude summary when the server is configured. The content teammate's composer adds section picking and Markdown export."
    >
      <p className="an-note">{p.headline}</p>
      {p.brief ? (
        <BriefPanel {...p.brief} />
      ) : (
        <p className="an-muted">
          Select a watch area first.{' '}
          <button type="button" className="an-row-btn" onClick={p.onOpenVolcanoes}>
            Open the Volcanoes section
          </button>
        </p>
      )}
    </AnalystSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Sources & methods

export interface SourcesInterimProps {
  snapshotSources: SnapshotSource[];
  snapshotAt: string | null;
  feeds: WarningFeedStatus[];
  connectors: { label: string; status: ConnectorStatus | { status: string; retrievedAt: string | null; message: string | null }; url?: string; kind: string }[];
}

export function SourcesInterim(p: SourcesInterimProps) {
  return (
    <AnalystSection
      id="sources"
      title="Sources & methods"
      lede="Every feed, how it was retrieved, when, and under what licence. Modes: LIVE means fetched this session; SNAPSHOT means a bundled copy with its real capture time; MODELLED means model output, context only, never evidence; OFFICIAL means an issuer's own words."
      meta={p.snapshotAt ? `snapshot ${formatUtc(p.snapshotAt)}` : undefined}
    >
      <AnalystSubhead>Bundled real-data snapshot</AnalystSubhead>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Provider</th>
              <th>Retrieved</th>
              <th className="an-num">Rows kept</th>
              <th>Licence</th>
            </tr>
          </thead>
          <tbody>
            {p.snapshotSources.map((s) => (
              <tr key={s.id}>
                <td>
                  <ExternalLink href={s.productUrl}>{s.name}</ExternalLink>
                </td>
                <td>{s.provider}</td>
                <td className="mono">{formatUtc(s.retrievedAt)}</td>
                <td className="an-num mono">
                  {s.rowsKept} / {s.rowsRead}
                </td>
                <td>{s.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnalystSubhead>Official warning feeds</AnalystSubhead>
      <ul className="ow-feeds-list" style={{ maxHeight: 'none', padding: 0 }}>
        {p.feeds.map((f) => (
          <li key={f.feedId} className={`ow-feed ow-feed--${f.status}`}>
            <span className="ow-feed-issuer">
              <ExternalLink href={f.issuerUrl}>{f.issuer}</ExternalLink>
            </span>
            {' · '}
            {f.status === 'unavailable' ? (
              <span className="ow-feed-status">Official feed unavailable: check {f.issuer} directly</span>
            ) : (
              <span className="ow-feed-status">
                {f.status === 'snapshot' ? 'saved snapshot' : f.status}
                {f.retrievedAt ? ` · ${formatUtc(f.retrievedAt)}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>

      <AnalystSubhead>Model and connector feeds</AnalystSubhead>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Feed</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Retrieved</th>
            </tr>
          </thead>
          <tbody>
            {p.connectors.map((c) => (
              <tr key={c.label}>
                <td>{c.url ? <ExternalLink href={c.url}>{c.label}</ExternalLink> : c.label}</td>
                <td>
                  <ModeBadge mode={c.kind} />
                </td>
                <td>{c.status.status === 'unavailable' ? `${c.label} unavailable: check the source directly` : c.status.status}</td>
                <td className="mono">{c.status.retrievedAt ? formatUtc(c.status.retrievedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnalystSubhead>Limitations</AnalystSubhead>
      <ul className="quality-list">
        <li>Haze, wind, ash drift and river flow are model output (CAMS, Open-Meteo, GloFAS). They are context, labelled MODELLED, and never evidence or an advisory.</li>
        <li>Hotspots are satellite detections, not confirmed fires; cloud and smoke hide them. A day with none does not mean no fire.</li>
        <li>There is no open numeric SO2 feed, so gas evidence is empty and links out to MOUNTS (research, not official).</li>
        <li>FIRMS and the earthquake catalogs come from the bundled snapshot only (no CORS); warnings, NEA and the models refresh live when online.</li>
        <li>Official levels and warnings are relayed verbatim and never re-scored. An unreachable feed is reported as unavailable, never as "no warnings".</li>
        <li>Our workflow states (Monitoring, Check observation, Review needed) come from stated illustrative rules and are not official alert levels.</li>
      </ul>
    </AnalystSection>
  );
}
