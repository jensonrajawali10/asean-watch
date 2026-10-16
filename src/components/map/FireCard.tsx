// Map-mode card for fires (docs/UX_V3.md section 2): three facts (hotspots in the last 24 h, summed fire
// power, change against the 24 h before), one plain sentence, a 7-day bar strip, the MODELLED smoke heading
// when a 925 hPa wind grid is given, and "Open in workspace". MEASURED (NASA FIRMS); never emissions.
//
// It takes the typed pick from fireLayers.ts directly: a cluster badge, a province/country badge, or a
// grid cell (shown as its cluster when the cell belongs to one of the top clusters).
import { useMemo } from 'react';
import { MapCard } from '../ui/MapCard';
import type { MapCardFact } from '../ui/MapCard';
import { MiniBars } from '../analyst/AnalystSection';
import {
  changeWords,
  clusterAt,
  clusterSentence,
  dailyValues,
  formatCount,
  formatFireTime,
  formatMw,
  formatPct,
  NO_DETECTION_NOTE,
  smokeHeading,
} from '../../lib/fires';
import type { FireCluster, FireRollup, FireSeries, FireSnapshot, SmokeHeading, SmokePlace } from '../../lib/fires';
import type { WindGrid } from '../../lib/windField';
import type { FirePick } from './fireLayers';
import './FireCard.css';

export interface FireCardProps {
  /** The pick from buildFireLayers (onClick) or firePickFromInfo. */
  pick: FirePick;
  snapshot: FireSnapshot;
  /** 925 hPa wind grid (loadWindField({ level: '925hPa' })) for the MODELLED smoke heading; omit to leave it out. */
  windGrid?: WindGrid | null;
  /** Start of the smoke path (e.g. the scrubber time); defaults to the wind grid's retrieval hour. */
  smokeStartISO?: string;
  /** Places the smoke path is checked against; defaults to DEFAULT_SMOKE_PLACES. */
  smokePlaces?: readonly SmokePlace[];
  /** "Open in workspace →": open the Fires section (and select the cluster there). */
  onOpenWorkspace: () => void;
  onClose?: () => void;
  className?: string;
}

const FireIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M8.2 1.2c.4 2.1-.6 3.3-1.6 4.4C5.5 6.8 4.5 8 4.5 9.9A3.6 3.6 0 0 0 8 13.6a3.6 3.6 0 0 0 3.5-3.7c0-1.3-.5-2.2-1.1-3 .1 1-.3 1.7-1 2 .4-2.4-.3-5.6-1.2-7.7Z"
      fill="currentColor"
    />
  </svg>
);

function mwParts(frp: number): { value: string; unit: string } {
  return { value: formatMw(frp).replace(/ MW$/, ''), unit: 'MW' };
}

function trendBars(s: FireSnapshot, series: FireSeries, what: string) {
  const days = dailyValues(s, series);
  return (
    <div className="firecard__bars">
      <MiniBars
        caption={`Hotspots per 24 h over 7 days; the last bar ends ${formatFireTime(s.reference)}`}
        bars={days.map((d) => ({
          label: d.label.split(' ')[0],
          value: d.count,
          highlight: d.p === 0,
          title: `${what}, 24 h to ${formatFireTime(d.end)}: ${formatCount(d.count)} hotspots, ${formatMw(d.frp)} summed FRP${d.partial ? ' (period starts before the files’ coverage)' : ''}`,
        }))}
      />
    </div>
  );
}

function changeFact(pct: number | null, before: number): MapCardFact {
  return {
    label: 'vs previous 24 h',
    value: pct === null ? (before > 0 ? '0%' : 'new') : formatPct(pct),
    note: 'fire power',
    tone: pct === null ? 'muted' : 'default',
  };
}

function HeadingLine({ heading }: { heading: SmokeHeading }) {
  return (
    <p className="firecard__heading">
      <span className="firecard__tag">MODELLED</span> {heading.sentence}{' '}
      <span className="firecard__muted">
        {heading.level} wind{heading.windDataMode === 'historical' ? `, snapshot ${formatFireTime(heading.windRetrievedAt)}` : ''}; not a dispersion model.
      </span>
    </p>
  );
}

export function FireCard({ pick, snapshot: s, windGrid, smokeStartISO, smokePlaces, onOpenWorkspace, onClose, className }: FireCardProps) {
  const cluster: FireCluster | null = useMemo(() => {
    if (pick.kind === 'fire-cluster') return pick.cluster;
    if (pick.kind === 'fire-cell') return clusterAt(s, pick.cell.lat, pick.cell.lon);
    return null;
  }, [pick, s]);

  const rollup: FireRollup | null = useMemo(() => {
    if (pick.kind !== 'fire-region') return null;
    const key = pick.badge.id.replace(/^badge:/, '');
    return s.regions.find((r) => r.key === key) ?? s.countries.find((c) => c.key === key) ?? null;
  }, [pick, s]);

  const heading = useMemo(
    () => (cluster && windGrid ? smokeHeading(cluster, windGrid, { startISO: smokeStartISO, places: smokePlaces }) : null),
    [cluster, windGrid, smokeStartISO, smokePlaces],
  );

  const source = (
    <>
      NASA FIRMS VIIRS and MODIS (MEASURED) · 24 h to {formatFireTime(s.reference)} · snapshot {formatFireTime(s.retrievedAt)}. FRP is fire
      intensity, not emissions.
    </>
  );
  const action = { label: 'Open in workspace', onClick: onOpenWorkspace, title: 'Open the Fires section of the analyst workspace' };

  if (cluster) {
    const facts: MapCardFact[] = [
      { label: 'Hotspots, 24 h', value: formatCount(cluster.last24h.count), note: `${formatCount(cluster.last7d.count)} in 7 days` },
      { label: 'Fire power, 24 h', ...mwParts(cluster.last24h.frp), note: 'summed FRP' },
      changeFact(cluster.frpChange24hPct, cluster.prev24h.frp),
    ];
    return (
      <MapCard
        className={className}
        icon={<FireIcon />}
        eyebrow={`Fire cluster · ${cluster.place.country}`}
        title={cluster.name}
        kind="measured"
        kindLabel="MEASURED · FIRMS"
        facts={facts}
        sentence={clusterSentence(cluster)}
        action={action}
        source={source}
        onClose={onClose}
      >
        {trendBars(s, cluster.series, cluster.name)}
        {heading && <HeadingLine heading={heading} />}
        {cluster.place.method.includes('approximate') && (
          <p className="firecard__muted">Place name from the nearest district or province centre: approximate.</p>
        )}
      </MapCard>
    );
  }

  if (rollup) {
    const n = rollup.last24h.count;
    const sentence =
      n > 0
        ? `${formatCount(n)} hotspots in the last 24 h across ${rollup.name}; ${changeWords(rollup.frpChange24hPct, rollup.last24h.frp, rollup.prev24h.frp, 'the day before')}.`
        : `No confident detections across ${rollup.name} in the last 24 h. ${NO_DETECTION_NOTE}`;
    return (
      <MapCard
        className={className}
        icon={<FireIcon />}
        eyebrow={rollup.kind === 'region' ? `Fires · ${rollup.country}` : 'Fires · country'}
        title={rollup.name}
        kind="measured"
        kindLabel="MEASURED · FIRMS"
        facts={[
          { label: 'Hotspots, 24 h', value: formatCount(n), note: `${formatCount(rollup.last7d.count)} in 7 days` },
          { label: 'Fire power, 24 h', ...mwParts(rollup.last24h.frp), note: 'summed FRP' },
          changeFact(rollup.frpChange24hPct, rollup.prev24h.frp),
        ]}
        sentence={sentence}
        action={action}
        source={source}
        onClose={onClose}
      >
        {trendBars(s, rollup.series, rollup.name)}
        {rollup.kind === 'region' && <p className="firecard__muted">Province from the nearest regency centre: approximate.</p>}
      </MapCard>
    );
  }

  // A grid cell outside the top clusters (or a region badge whose rollup is missing).
  if (pick.kind === 'fire-cell') {
    const c = pick.cell;
    const when = pick.recent ? 'the last 24 h' : 'the six days before the last 24 h';
    const lat = `${Math.abs(c.lat).toFixed(2)}°${c.lat < 0 ? 'S' : 'N'}`;
    const lon = `${Math.abs(c.lon).toFixed(2)}°${c.lon < 0 ? 'W' : 'E'}`;
    return (
      <MapCard
        className={className}
        icon={<FireIcon />}
        eyebrow={`Fire grid cell · ${c.cellDeg}°`}
        title={`Hotspots near ${lat} ${lon}`}
        kind="measured"
        kindLabel="MEASURED · FIRMS"
        facts={[
          { label: pick.recent ? 'Hotspots, 24 h' : 'Hotspots, days 2–7', value: formatCount(c.count) },
          { label: 'Fire power', ...mwParts(c.frp), note: 'summed FRP' },
          { label: 'Strongest', ...mwParts(c.frpMax), note: 'single detection' },
        ]}
        sentence={`${formatCount(c.count)} confident detection${c.count === 1 ? '' : 's'} in this ${c.cellDeg}° cell over ${when}, seen by ${c.sensors.length} sensor${c.sensors.length === 1 ? '' : 's'}.`}
        action={action}
        source={source}
        onClose={onClose}
      />
    );
  }

  if (pick.kind !== 'fire-region') return null;
  return (
    <MapCard
      className={className}
      icon={<FireIcon />}
      title={pick.badge.name}
      kind="measured"
      kindLabel="MEASURED · FIRMS"
      facts={[
        { label: 'Hotspots, 24 h', value: formatCount(pick.badge.count) },
        { label: 'Fire power, 24 h', ...mwParts(pick.badge.frp), note: 'summed FRP' },
      ]}
      sentence={`${formatCount(pick.badge.count)} hotspots in the last 24 h across ${pick.badge.name}.`}
      action={action}
      source={source}
      onClose={onClose}
    />
  );
}
