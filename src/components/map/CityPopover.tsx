// Small popover for a clicked haze city: MODELLED PM2.5 now and a 48 h modelled sparkline (inline SVG),
// with source, model and run time. Singapore also shows NEA MEASURED PSI in a visibly different chip.
// Place it inside the map container (position: relative); `anchor` is the click point in that container.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { HazeReading } from '../../types';
import { PM25_BANDS_NOTE, pm25Band, placePm25At } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import './CityPopover.css';

export interface CityPopoverProps {
  cityId: string;
  airQuality: AirQualityData;
  /** The scrubber's selected hour. */
  timeISO: string;
  /** The scrubber's "now" step (start of the 48 h sparkline). */
  nowISO: string;
  /** NEA measured haze; shown for Singapore only. */
  neaHaze?: HazeReading | null;
  anchor?: { x: number; y: number } | null;
  dark?: boolean;
  onClose: () => void;
}

const W = 260;
const H = 64;
const PAD = { l: 4, r: 4, t: 8, b: 14 };
const HOUR = 3_600_000;

const utc = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)} UTC`;
};

export default function CityPopover({ cityId, airQuality, timeISO, nowISO, neaHaze, anchor, dark = false, onClose }: CityPopoverProps) {
  const place = airQuality.places.find((p) => p.id === cityId) ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: false });

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setFlip({ x: anchor.x + 14 + w > parent.clientWidth - 8, y: anchor.y - 14 - h < 8 });
  }, [anchor, cityId]);

  const spark = useMemo(() => {
    if (!place) return null;
    const t0 = Date.parse(nowISO);
    const t1 = t0 + 48 * HOUR;
    const pts = airQuality.times
      .map((t, k) => ({ ms: Date.parse(t), v: place.pm25[k] }))
      .filter((p) => p.ms >= t0 && p.ms <= t1);
    if (pts.length < 2) return null;
    const vmax = Math.max(60, ...pts.map((p) => p.v)) * 1.08;
    const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1].ms).toFixed(1)} ${y(0).toFixed(1)} L${x(pts[0].ms).toFixed(1)} ${y(0).toFixed(1)} Z`;
    const peak = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]);
    const sel = Date.parse(timeISO);
    const selV = placePm25At(airQuality, place, timeISO);
    return {
      line,
      area,
      guide: vmax > 55 ? y(55) : null,
      peak,
      first: pts[0],
      last: pts[pts.length - 1],
      sel: sel >= t0 && sel <= t1 ? { x: x(sel), y: y(selV) } : null,
      baseY: y(0),
    };
  }, [airQuality, place, nowISO, timeISO]);

  if (!place) return null;
  const value = placePm25At(airQuality, place, timeISO);
  const band = pm25Band(value);
  const isSg = place.id === 'singapore';
  const psiValues = isSg && neaHaze ? Object.values(neaHaze.psi24h).filter((v) => Number.isFinite(v)) : [];
  const psiMax = psiValues.length ? Math.max(...psiValues) : null;
  const run = `${airQuality.dataMode === 'historical' ? 'SNAPSHOT' : 'LIVE'} run ${utc(airQuality.retrievedAt)}`;

  const style: CSSProperties | undefined = anchor
    ? {
        left: anchor.x,
        top: anchor.y,
        transform: `translate(${flip.x ? 'calc(-100% - 14px)' : '14px'}, ${flip.y ? '14px' : 'calc(-100% - 14px)'})`,
      }
    : undefined;

  return (
    <div
      ref={ref}
      className={`city-popover${dark ? ' is-dark' : ''}${anchor ? ' is-anchored' : ''}`}
      style={style}
      role="dialog"
      aria-label={`${place.name}: modelled PM2.5`}
      data-no-pan
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="city-popover__head">
        <h3>
          {place.name}
          {place.kind === 'fire-area' && <span className="city-popover__kind">fire-prone area</span>}
        </h3>
        <button type="button" className="city-popover__close" aria-label={`Close ${place.name}`} onClick={onClose} autoFocus>
          ×
        </button>
      </div>
      <p className="city-popover__value">
        <span className="city-popover__badge">MODELLED</span>
        <strong>PM2.5 {Math.round(value)} µg/m³</strong>
        {band && (
          <span className="city-popover__band">
            <span className="city-popover__dot" style={{ background: band.color }} aria-hidden="true" />
            {band.label}
          </span>
        )}
      </p>
      <p className="city-popover__time">at {utc(timeISO)}</p>

      {spark && (
        <figure className="city-popover__spark">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={`Modelled PM2.5 for the next 48 hours: ${Math.round(spark.first.v)} to ${Math.round(spark.last.v)} µg/m³, peak ${Math.round(spark.peak.v)} at ${utc(new Date(spark.peak.ms).toISOString())}.`}
          >
            <path className="city-popover__area" d={spark.area} />
            {spark.guide !== null && <line className="city-popover__guide" x1={PAD.l} x2={W - PAD.r} y1={spark.guide} y2={spark.guide} />}
            <line className="city-popover__axis" x1={PAD.l} x2={W - PAD.r} y1={spark.baseY} y2={spark.baseY} />
            <path className="city-popover__line" d={spark.line} />
            {spark.sel && <circle className="city-popover__sel" cx={spark.sel.x} cy={spark.sel.y} r={3.5} />}
            <text className="city-popover__tick" x={PAD.l} y={H - 2}>
              now
            </text>
            <text className="city-popover__tick" x={W / 2} y={H - 2} textAnchor="middle">
              +24 h
            </text>
            <text className="city-popover__tick" x={W - PAD.r} y={H - 2} textAnchor="end">
              +48 h
            </text>
            {spark.guide !== null && (
              <text className="city-popover__tick" x={W - PAD.r} y={spark.guide - 2} textAnchor="end">
                55
              </text>
            )}
          </svg>
          <figcaption>
            48 h modelled · peak {Math.round(spark.peak.v)} µg/m³ {utc(new Date(spark.peak.ms).toISOString())}
          </figcaption>
        </figure>
      )}

      {isSg && neaHaze && psiMax !== null && (
        <p className="city-popover__nea">
          <span className="city-popover__nea-tag">NEA MEASURED</span> 24-h PSI {psiMax} ({neaHaze.psiBand}) ·{' '}
          {neaHaze.dataMode === 'historical' ? 'SNAPSHOT' : 'LIVE'} {neaHaze.observedAt.slice(11, 16)} UTC
        </p>
      )}

      <p className="city-popover__prov">
        {airQuality.model} via{' '}
        <a href={airQuality.sourceUrl} target="_blank" rel="noreferrer">
          {airQuality.source}
        </a>{' '}
        · {run}
      </p>
      <p className="city-popover__note">{PM25_BANDS_NOTE}</p>
    </div>
  );
}
