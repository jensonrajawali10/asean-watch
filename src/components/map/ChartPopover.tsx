// Popovers for the connector layers, styled like CityPopover (same classes and tokens):
// - TideGaugePopover: an IOC tide gauge's last 24 h of raw readings (loaded on open), inline SVG chart,
//   "Raw tide gauge data, not a tsunami warning (IOC/VLIZ)".
// - RiverFlowPopover: GloFAS 15-day modelled discharge for one river point, "MODELLED (GloFAS via
//   Open-Meteo), not a flood warning".
// Place inside the map container; `anchor` is the point in that container.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { RiverDischargeSeries, SeaLevelSeries, SeaLevelStation } from '../../types';
import { loadSeaLevelReadings, seaLevelStationPage, SEA_LEVEL_ATTRIBUTION } from '../../lib/seaLevel';
import { FLOOD_MODEL_ATTRIBUTION, FLOOD_MODEL_NOTE } from '../../lib/floodModel';
import { lineChart } from './connectorRender';
import './ChartPopover.css';

const W = 260;
const H = 72;
const PAD = 8;

const utc = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)} UTC`;
};
const fmt = (v: number, digits = 2) => String(Number(v.toFixed(digits)));

function Shell({
  label,
  title,
  anchor,
  dark,
  onClose,
  children,
}: {
  label: string;
  title: ReactNode;
  anchor: { x: number; y: number };
  dark: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: false });
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    setFlip({ x: anchor.x + 14 + el.offsetWidth > parent.clientWidth - 8, y: anchor.y - 14 - el.offsetHeight < 8 });
  }, [anchor]);
  const style: CSSProperties = {
    left: anchor.x,
    top: anchor.y,
    transform: `translate(${flip.x ? 'calc(-100% - 14px)' : '14px'}, ${flip.y ? '14px' : 'calc(-100% - 14px)'})`,
  };
  return (
    <div
      ref={ref}
      className={`city-popover is-anchored chart-popover${dark ? ' is-dark' : ''}`}
      style={style}
      role="dialog"
      aria-label={label}
      data-no-pan
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="city-popover__head">
        <h3>{title}</h3>
        <button type="button" className="city-popover__close" aria-label={`Close ${label}`} onClick={onClose} autoFocus>
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function Chart({ points, ariaLabel, left, right }: { points: { t: number; v: number | null }[]; ariaLabel: string; left: string; right: string }) {
  const c = lineChart(points, W, H, PAD);
  if (!c) return <p className="city-popover__time">Not enough values to draw a chart.</p>;
  return (
    <figure className="city-popover__spark">
      <svg viewBox={`0 0 ${W} ${H + 12}`} width={W} height={H + 12} role="img" aria-label={ariaLabel}>
        <line className="city-popover__axis" x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
        <path className="city-popover__line" d={c.path} />
        <text className="city-popover__tick" x={PAD} y={H + 10}>
          {left}
        </text>
        <text className="city-popover__tick" x={W - PAD} y={H + 10} textAnchor="end">
          {right}
        </text>
      </svg>
    </figure>
  );
}

export function TideGaugePopover({
  station,
  anchor,
  dark,
  onClose,
}: {
  station: SeaLevelStation;
  anchor: { x: number; y: number };
  dark: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ code: string; series: SeaLevelSeries | null; message: string } | null>(null);
  useEffect(() => {
    let alive = true;
    loadSeaLevelReadings(station.code)
      .then((r) => {
        if (alive) setState({ code: station.code, series: r.series, message: r.status.message });
      })
      .catch((err: unknown) => {
        if (alive) setState({ code: station.code, series: null, message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, [station.code]);
  const loaded = state && state.code === station.code ? state : null;
  const series = loaded?.series ?? null;
  const values = series?.readings ?? [];
  const pts = values.map((r) => ({ t: Date.parse(r.timeISO), v: r.value }));
  const vals = values.map((r) => r.value);
  return (
    <Shell label={`Tide gauge ${station.name}`} title={station.name} anchor={anchor} dark={dark} onClose={onClose}>
      <p className="city-popover__value">
        <span className="city-popover__badge">RAW</span>
        <strong>Tide gauge (IOC {station.code})</strong>
      </p>
      <p className="city-popover__note">Raw tide gauge data, not a tsunami warning (IOC/VLIZ)</p>
      {!loaded && <p className="city-popover__time">Loading the last 24 h…</p>}
      {loaded && !series && <p className="city-popover__time">Readings unavailable: {loaded.message}</p>}
      {series && values.length > 0 && (
        <>
          <Chart
            points={pts}
            ariaLabel={`Raw sea level at ${station.name}, last 24 hours, ${fmt(Math.min(...vals))} to ${fmt(Math.max(...vals))} m on the station datum.`}
            left={utc(values[0].timeISO)}
            right={utc(values[values.length - 1].timeISO)}
          />
          <p className="city-popover__time">
            {fmt(Math.min(...vals))} to {fmt(Math.max(...vals))} m (station datum, includes the tide) · sensor {series.sensor} ·{' '}
            {series.dataMode === 'live' ? 'Live' : 'Saved'} {utc(series.retrievedAt)}
          </p>
        </>
      )}
      <p className="city-popover__prov">
        <a href={seaLevelStationPage(station.code)} target="_blank" rel="noreferrer">
          IOC station page
        </a>{' '}
        · {SEA_LEVEL_ATTRIBUTION}
      </p>
    </Shell>
  );
}

export function RiverFlowPopover({
  series,
  anchor,
  dark,
  onClose,
}: {
  series: RiverDischargeSeries;
  anchor: { x: number; y: number };
  dark: boolean;
  onClose: () => void;
}) {
  const pts = series.days.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), v: d.dischargeM3s }));
  const vals = series.days.map((d) => d.dischargeM3s).filter((v): v is number => v !== null);
  const today = series.days.find((d) => d.kind === 'today');
  return (
    <Shell label={`${series.river} at ${series.place}: modelled river flow`} title={`${series.river} · ${series.place}`} anchor={anchor} dark={dark} onClose={onClose}>
      <p className="city-popover__value">
        <span className="city-popover__badge">MODELLED</span>
        <strong>
          {today?.dischargeM3s != null ? `${Math.round(today.dischargeM3s).toLocaleString('en-US')} m³/s today` : 'River discharge'}
        </strong>
      </p>
      <p className="city-popover__note">River flow forecast (GloFAS via Open-Meteo), not a flood warning</p>
      {series.days.length > 0 && vals.length > 0 && (
        <Chart
          points={pts}
          ariaLabel={`Modelled discharge of the ${series.river} at ${series.place} over ${series.days.length} days, ${Math.round(Math.min(...vals))} to ${Math.round(Math.max(...vals))} m³/s.`}
          left={series.days[0].date}
          right={series.days[series.days.length - 1].date}
        />
      )}
      <p className="city-popover__time">
        {series.days.length} days ({series.days.filter((d) => d.kind === 'forecast').length} forecast) ·{' '}
        {series.dataMode === 'live' ? 'Live' : 'Saved'} {utc(series.retrievedAt)} · cell {fmt(series.cell.lat)}, {fmt(series.cell.lon)}
      </p>
      <p className="city-popover__prov">{FLOOD_MODEL_NOTE}</p>
      <p className="city-popover__note">{FLOOD_MODEL_ATTRIBUTION}</p>
    </Shell>
  );
}
