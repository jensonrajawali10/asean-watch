// Water & tsunami section of the analyst workspace (docs/UX_V3.md section 3.6). Official first (PTWC and
// BMKG InaTEWS, verbatim), then the relayed flood gauges, then the raw tide gauges and the MODELLED GloFAS
// river flow, each with its map toggle. Summarised from the data App already loads; nothing is fetched here.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { OfficialWarning, RiverDischargeSeries, SeaLevelStation } from '../../types';
import type { GaugeReading } from '../../lib/warnings';
import type { PtwcResult } from '../../lib/ptwc';
import type { FloodModelResult } from '../../lib/floodModel';
import { FLOOD_MODEL_NOTE } from '../../lib/floodModel';
import { SEA_LEVEL_NOTE } from '../../lib/seaLevel';
import { selectTsunamiAreaWarnings } from '../../lib/tsunamiAreas';
import { isExpired } from '../../lib/warningsView';
import { useNowMs } from '../../lib/useNowMs';
import { EndedChip, ExternalLink, ModeBadge, OfficialLevelChip, OfficialTag } from '../Badges';
import { formatUtc, formatValue } from '../format';
import type { MapLayerState } from '../map/layerCatalog';
import { AnalystSection, AnalystSubhead, KeyFigure } from './AnalystSection';
import type { SectionSource } from './AnalystSection';
import { BMKG_AREAS_PREVIEW, bmkgAreasBySeverity, isPtwcInformation } from './waterView';

export interface WaterSectionProps {
  ptwc: PtwcResult;
  warnings: OfficialWarning[];
  gauges: GaugeReading[];
  tideStations: SeaLevelStation[];
  tideListRetrievedAt: string | null;
  /** Null until the bundled snapshot or the live run has loaded (moments after first paint). */
  riverFlow: FloodModelResult | null;
  layers: MapLayerState;
  onLayersChange: (patch: Partial<MapLayerState>) => void;
  onInspectWarning: (id: string) => void;
}

function gaugeAboveThreshold(g: GaugeReading): boolean {
  if (!g.thresholds) return false;
  const values = Object.values(g.thresholds).filter((v) => Number.isFinite(v));
  return values.length > 0 && g.value >= Math.min(...values);
}

function riverRow(s: RiverDischargeSeries) {
  const today = s.days.find((d) => d.kind === 'today') ?? null;
  const past = s.days.filter((d) => d.kind === 'past' && d.dischargeM3s !== null);
  const forecast = s.days.filter((d) => d.kind === 'forecast' && d.dischargeM3s !== null);
  const weekAgo = past[0]?.dischargeM3s ?? null;
  const peak = forecast.reduce<{ v: number; date: string } | null>((m, d) => (d.dischargeM3s !== null && (!m || d.dischargeM3s > m.v) ? { v: d.dischargeM3s, date: d.date } : m), null);
  const change = today?.dischargeM3s != null && weekAgo != null && weekAgo > 0 ? Math.round(((today.dischargeM3s - weekAgo) / weekAgo) * 100) : null;
  return { today: today?.dischargeM3s ?? null, change, peak };
}

const fmtQ = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('en-US'));

export default function WaterSection(p: WaterSectionProps) {
  const nowMs = useNowMs();
  const ptwcWarning = p.ptwc.warnings[0] ?? null;
  const ptwcEnded = ptwcWarning ? isExpired(ptwcWarning, nowMs) : false;
  const tsunami = selectTsunamiAreaWarnings(p.warnings, nowMs);
  const bmkg = tsunami.inForce ?? tsunami.latest;
  const bmkgEnded = bmkg ? isExpired(bmkg, nowMs) : false;
  const [showAllAreas, setShowAllAreas] = useState(false);
  const bmkgAreas = bmkg ? bmkgAreasBySeverity(bmkg.areas) : [];
  const areasShown = showAllAreas ? bmkgAreas : bmkgAreas.slice(0, BMKG_AREAS_PREVIEW);
  const ptwcInfo = ptwcWarning ? isPtwcInformation(ptwcWarning.level) : false;
  /** Other official tsunami messages in force (JMA, NWS, PTWC...), by issuer, for the status strip. */
  const otherActive = new Map<string, number>();
  for (const w of [...p.warnings, ...(ptwcWarning ? [ptwcWarning] : [])]) {
    if (w.authority !== 'official' || w.hazard !== 'tsunami' || isExpired(w, nowMs) || w.id === tsunami.inForce?.id) continue;
    otherActive.set(w.issuer, (otherActive.get(w.issuer) ?? 0) + 1);
  }
  const relayedGauges = p.gauges.filter((g) => g.situation !== null || gaugeAboveThreshold(g));
  const otherGauges = p.gauges.length - relayedGauges.length;
  const recentStations = p.tideStations.filter((s) => s.lastTimeISO && nowMs - Date.parse(s.lastTimeISO) < 48 * 3600000).length;
  const toggle = (key: keyof MapLayerState, on: boolean) => p.onLayersChange({ [key]: on } as Partial<MapLayerState>);

  const sources: SectionSource[] = [
    { label: 'NOAA/NWS Pacific Tsunami Warning Center', url: 'https://www.tsunami.gov/', mode: p.ptwc.status.status === 'live' || p.ptwc.status.status === 'cached' ? 'LIVE' : 'SNAPSHOT', retrievedAt: p.ptwc.status.retrievedAt },
    { label: 'BMKG InaTEWS tsunami messages', url: 'https://inatews.bmkg.go.id/', mode: 'OFFICIAL' },
    { label: 'IOC Sea Level Station Monitoring Facility (VLIZ)', url: 'https://www.ioc-sealevelmonitoring.org/', mode: 'MEASURED', retrievedAt: p.tideListRetrievedAt, licence: 'DOI 10.14284/482' },
    { label: 'GloFAS river discharge via Open-Meteo Flood API', url: 'https://open-meteo.com/en/docs/flood-api', mode: 'MODELLED', retrievedAt: p.riverFlow?.status.retrievedAt ?? null, licence: 'CC BY 4.0' },
    { label: 'ThaiWater (HII), DSDA Jakarta Posko Banjir, PUB Singapore flood alerts', mode: 'OFFICIAL' },
  ];

  // Official tsunami messages first; an in-force BMKG message comes before PTWC's latest product.
  const ptwcBlock: ReactNode = (
    <>
      <AnalystSubhead>PTWC: latest product</AnalystSubhead>
      {ptwcWarning ? (
        <div className={`ow-item ${ptwcEnded ? 'ow-item--ended' : ptwcInfo ? 'ow-item--info' : 'ow-item--official'}`}>
          <div className="ow-eyebrow">
            <OfficialTag issuer={ptwcWarning.issuer} authority="official" />
            <ModeBadge mode={ptwcWarning.dataMode} time={ptwcWarning.dataMode === 'historical' ? ptwcWarning.retrievedAt : null} />
          </div>
          <div className="ow-level">
            <OfficialLevelChip level={ptwcWarning.level} ended={ptwcEnded} />
            <EndedChip warning={ptwcWarning} nowMs={nowMs} />
          </div>
          <p className="ow-headline">{ptwcWarning.headline}</p>
          <p className="ow-meta">{ptwcWarning.issuedAt ? <>Issued {formatUtc(ptwcWarning.issuedAt)}</> : <>No issue time published</>}</p>
          <p className="ow-note">{p.ptwc.note}</p>
          <div className="ow-actions">
            <button type="button" className="link-button" onClick={() => p.onInspectWarning(ptwcWarning.id)}>
              Details
            </button>
            <ExternalLink className="ow-follow" href={ptwcWarning.issuerUrl}>
              Follow {ptwcWarning.issuer}
            </ExternalLink>
          </div>
        </div>
      ) : (
        <p className="an-note an-note--official">{p.ptwc.status.message ?? 'Official feed unavailable: check the Pacific Tsunami Warning Center directly'}</p>
      )}
    </>
  );
  const bmkgBlock: ReactNode = (
    <>
      <AnalystSubhead>BMKG InaTEWS: tsunami warning areas</AnalystSubhead>
      {bmkg ? (
        <>
          <div className={`ow-item ${bmkgEnded ? 'ow-item--ended' : 'ow-item--official'}`}>
            <div className="ow-eyebrow">
              <OfficialTag issuer={bmkg.issuer} authority="official" />
              <ModeBadge mode={bmkg.dataMode} time={bmkg.dataMode === 'historical' ? bmkg.retrievedAt : null} />
            </div>
            <div className="ow-level">
              <OfficialLevelChip level={bmkg.level} gloss={bmkg.levelGloss} ended={bmkgEnded} />
              <EndedChip warning={bmkg} nowMs={nowMs} />
            </div>
            <p className="ow-meta">
              Issued {formatUtc(bmkg.issuedAt)} · {bmkg.areas.length} named areas
              {bmkg.observations?.length ? ` · ${bmkg.observations.length} observed heights` : ''}
            </p>
            {bmkgEnded ? (
              <details className="an-ended-details">
                <summary>Show this ended message verbatim and its {bmkg.areas.length} named areas</summary>
                <p className="ow-headline" lang="id">
                  {bmkg.headline}
                </p>
                <div className="an-table-wrap">
                  <table className="an-table an-tsunami-areas">
                    <caption>Areas as named by BMKG with their verbatim per-area level, most severe level first (our ordering).</caption>
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Province</th>
                        <th>Level (verbatim)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areasShown.map((a, i) => (
                        <tr key={`${a.name}-${i}`}>
                          <td lang="id">{a.name}</td>
                          <td lang="id">{a.province ?? '—'}</td>
                          <td lang="id" className={`an-bmkg-level an-bmkg-level--${(a.level ?? '').trim().toLowerCase() || 'none'}`}>
                            {a.level ?? 'not stated'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bmkgAreas.length > BMKG_AREAS_PREVIEW && (
                    <button type="button" className="link-button an-show-all" aria-expanded={showAllAreas} onClick={() => setShowAllAreas((v) => !v)}>
                      {showAllAreas ? 'Show the most severe only' : `Show all ${bmkgAreas.length} named areas`}
                    </button>
                  )}
                </div>
              </details>
            ) : (
              <>
                <p className="ow-headline" lang="id">
                  {bmkg.headline}
                </p>
                <div className="an-table-wrap">
                  <table className="an-table an-tsunami-areas">
                    <caption>Areas as named by BMKG with their verbatim per-area level, most severe level first (our ordering).</caption>
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Province</th>
                        <th>Level (verbatim)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areasShown.map((a, i) => (
                        <tr key={`${a.name}-${i}`}>
                          <td lang="id">{a.name}</td>
                          <td lang="id">{a.province ?? '—'}</td>
                          <td lang="id" className={`an-bmkg-level an-bmkg-level--${(a.level ?? '').trim().toLowerCase() || 'none'}`}>
                            {a.level ?? 'not stated'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bmkgAreas.length > BMKG_AREAS_PREVIEW && (
                    <button type="button" className="link-button an-show-all" aria-expanded={showAllAreas} onClick={() => setShowAllAreas((v) => !v)}>
                      {showAllAreas ? 'Show the most severe only' : `Show all ${bmkgAreas.length} named areas`}
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="ow-actions">
              <button type="button" className="link-button" onClick={() => p.onInspectWarning(bmkg.id)}>
                Details
              </button>
              <ExternalLink className="ow-follow" href={bmkg.issuerUrl}>
                Follow {bmkg.issuer}
              </ExternalLink>
            </div>
          </div>
          <label className="ws-layer">
            <input type="checkbox" checked={p.layers.tsunami} onChange={(e) => toggle('tsunami', e.currentTarget.checked)} />
            <span className="ws-layer__label">Show the warning areas on the map</span>
            <span className="ws-layer__exp">District centres, approximate; levels verbatim.</span>
          </label>
          {!tsunami.inForce && (
            <label className="ws-layer">
              <input type="checkbox" checked={p.layers.tsunamiHistory} onChange={(e) => toggle('tsunamiHistory', e.currentTarget.checked)} />
              <span className="ws-layer__label">Show the last (ended) message's areas</span>
              <span className="ws-layer__exp">History only; it is labelled with its real issue time and ended state.</span>
            </label>
          )}
        </>
      ) : (
        <p className="an-note an-note--official">No BMKG InaTEWS message with warning areas is on file. This is not an all-clear: check BMKG directly.</p>
      )}
    </>
  );

  return (
    <AnalystSection
      id="water"
      title="Tsunami & floods"
      lede="Official tsunami messages first, relayed verbatim. Then the flood gauges the agencies publish, the raw IOC tide gauges, and the modelled GloFAS river flow. Raw gauges and model output are never warnings; the official word comes from BMKG, PTWC through national authorities, JMA, PHIVOLCS and the national flood agencies."
      sources={sources}
    >
      <div className={`an-tsunami-status ${tsunami.inForce ? 'an-tsunami-status--active' : ''}`} role="status">
        <span className="an-tsunami-status__label">BMKG InaTEWS tsunami message</span>
        {tsunami.inForce ? (
          <>
            <span className="an-tsunami-status__head">
              In force: <OfficialLevelChip level={tsunami.inForce.level} gloss={tsunami.inForce.levelGloss} ended={false} />
            </span>
            <span className="an-tsunami-status__meta">
              Issued {formatUtc(tsunami.inForce.issuedAt)} · {tsunami.inForce.areas.length} named areas · follow BMKG and local authorities
            </span>
          </>
        ) : (
          <>
            <span className="an-tsunami-status__head">None in force in the loaded feed</span>
            <span className="an-tsunami-status__meta">
              {tsunami.latest ? `Last message with areas: ${formatUtc(tsunami.latest.issuedAt)}, ended. ` : ''}Not an all-clear: check BMKG directly.
            </span>
          </>
        )}
        {otherActive.size > 0 && (
          <span className="an-tsunami-status__others">
            Other official tsunami messages in force:{' '}
            {[...otherActive.entries()].map(([issuer, n]) => `${issuer} (${n})`).join(', ')}. Listed in Warnings.
          </span>
        )}
      </div>

      <div className="an-figures">
        <KeyFigure label="Flood gauges relayed" value={String(relayedGauges.length)} note={`${otherGauges} more below threshold`} />
        <KeyFigure label="Tide gauges (APAC)" value={String(p.tideStations.length)} note={`${recentStations} reported in the last 48 h at list capture`} />
        <KeyFigure
          label="River points (modelled)"
          value={p.riverFlow ? String(p.riverFlow.series.length) : '…'}
          note={!p.riverFlow ? 'loading GloFAS run' : p.riverFlow.status.status === 'live' || p.riverFlow.status.status === 'cached' ? 'live GloFAS run' : 'saved GloFAS run'}
        />
      </div>

      {tsunami.inForce ? (
        <>
          {bmkgBlock}
          {ptwcBlock}
        </>
      ) : (
        <>
          {ptwcBlock}
          {bmkgBlock}
        </>
      )}

      <AnalystSubhead>Flood gauges relayed by their agencies</AnalystSubhead>
      {relayedGauges.length > 0 ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption>Gauges with a published situation or at or above the issuer's lowest threshold. Situation text is the issuer's own.</caption>
            <thead>
              <tr>
                <th>Gauge</th>
                <th>Issuer</th>
                <th className="an-num">Level</th>
                <th>Situation (verbatim)</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {relayedGauges.slice(0, 60).map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>{g.issuer}</td>
                  <td className="an-num mono">
                    {formatValue(g.value, g.unit)} <span className="an-muted">({g.datum})</span>
                  </td>
                  <td>{g.situation ?? <span className="an-muted">above threshold</span>}</td>
                  <td className="mono">{formatUtc(g.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="an-muted">No gauge is currently above its issuer's threshold in the loaded feeds. Not an all-clear: feeds can be stale or unavailable.</p>
      )}

      <AnalystSubhead>Tide gauges (IOC, raw)</AnalystSubhead>
      <p className="an-note">{SEA_LEVEL_NOTE}</p>
      <label className="ws-layer">
        <input type="checkbox" checked={p.layers.tide} onChange={(e) => toggle('tide', e.currentTarget.checked)} />
        <span className="ws-layer__label">Show tide gauges on the map</span>
        <span className="ws-layer__exp">{p.tideStations.length} APAC stations from the bundled list{p.tideListRetrievedAt ? ` captured ${formatUtc(p.tideListRetrievedAt)}` : ''}; click one for its last 24 h.</span>
      </label>

      <AnalystSubhead>River flow (modelled, GloFAS)</AnalystSubhead>
      <p className="an-note">{FLOOD_MODEL_NOTE}</p>
      {!p.riverFlow ? (
        <p className="an-muted">Loading the GloFAS river model…</p>
      ) : p.riverFlow.series.length > 0 ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption>
              MODELLED discharge, m³/s · {p.riverFlow.status.status === 'live' || p.riverFlow.status.status === 'cached' ? 'live run' : 'saved run'} {formatUtc(p.riverFlow.status.retrievedAt)}
            </caption>
            <thead>
              <tr>
                <th>River · place</th>
                <th className="an-num">Today</th>
                <th className="an-num">vs 7 days ago</th>
                <th className="an-num">Forecast peak</th>
              </tr>
            </thead>
            <tbody>
              {p.riverFlow.series.map((s) => {
                const r = riverRow(s);
                return (
                  <tr key={s.pointId}>
                    <td>
                      {s.river} · {s.place}
                    </td>
                    <td className="an-num mono">{fmtQ(r.today)}</td>
                    <td className="an-num mono">{r.change === null ? '—' : `${r.change > 0 ? '+' : ''}${r.change} %`}</td>
                    <td className="an-num mono">
                      {r.peak ? `${fmtQ(r.peak.v)} on ${r.peak.date}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="an-muted">{p.riverFlow.status.message}</p>
      )}
      <label className="ws-layer">
        <input type="checkbox" checked={p.layers.river} onChange={(e) => toggle('river', e.currentTarget.checked)} />
        <span className="ws-layer__label">Show river points on the map</span>
        <span className="ws-layer__exp">Click a point for its 15-day modelled discharge.</span>
      </label>
    </AnalystSection>
  );
}
