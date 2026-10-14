// Plain-language popover for a clicked haze city. Top to bottom: what it is (a model forecast, not a
// measurement); the band, the number and its unit in words; what the number means and its scale against the
// WHO 24-hour guideline; the next 48 hours (MODELLED) with the worst hour in local time; how far to trust it;
// where the official word is (Singapore also shows NEA's MEASURED PSI); technical details behind a disclosure.
// Place it inside the map container (position: relative); `anchor` is the click point in that container.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { HazeReading } from '../../types';
import { PM25_BANDS_NOTE, PM25_UNIT_WORDS, WHO_PM25_24H_UGM3, describePm25, placePm25At } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import { AIR_QUALITY_OFFICIAL, COUNTRY_NAME, localTimeLabel, placeRef } from '../../lib/places';
import { ExternalLink, InfoIcon } from './PopoverParts';
import './CityPopover.css';

export interface CityPopoverProps {
  cityId: string;
  airQuality: AirQualityData;
  /** The scrubber's selected hour. */
  timeISO: string;
  /** The scrubber's "now" step (start of the 48 h chart). */
  nowISO: string;
  /** NEA measured haze; shown for Singapore only. */
  neaHaze?: HazeReading | null;
  anchor?: { x: number; y: number } | null;
  dark?: boolean;
  onClose: () => void;
}

const W = 276;
const H = 58;
const PAD = { l: 4, r: 4, t: 6, b: 14 };
const HOUR = 3_600_000;

const utc = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)} UTC`;
};
const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const group = (n: number) => Math.round(n).toLocaleString('en-US');

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
    const vmax = Math.max(40, ...pts.map((p) => p.v)) * 1.08;
    const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1].ms).toFixed(1)} ${y(0).toFixed(1)} L${x(pts[0].ms).toFixed(1)} ${y(0).toFixed(1)} Z`;
    const peak = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]);
    const sel = Date.parse(timeISO);
    const selV = placePm25At(airQuality, place, timeISO);
    // The WHO 24-hour guideline as a dashed reference, only where it sits clear of the baseline.
    const whoY = WHO_PM25_24H_UGM3 / vmax > 0.12 ? y(WHO_PM25_24H_UGM3) : null;
    return {
      line,
      area,
      whoY,
      peak,
      first: pts[0],
      last: pts[pts.length - 1],
      sel: sel >= t0 && sel <= t1 ? { x: x(sel), y: y(selV) } : null,
      baseY: y(0),
    };
  }, [airQuality, place, nowISO, timeISO]);

  if (!place) return null;
  const where = placeRef(place);
  const value = placePm25At(airQuality, place, timeISO);
  const d = describePm25(value);
  const snapshot = airQuality.dataMode === 'historical';
  const official = AIR_QUALITY_OFFICIAL[place.country] ?? null;
  const isSg = place.id === 'singapore';
  const psiValues = isSg && neaHaze ? Object.values(neaHaze.psi24h).filter((v) => Number.isFinite(v)) : [];
  const psiMax = psiValues.length ? Math.max(...psiValues) : null;
  const runLocal = localTimeLabel(airQuality.retrievedAt, where, { utc: false });
  const area = place.kind === 'fire-area' ? 'this district' : 'the city';

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
      aria-label={`${place.name}: modelled air-quality forecast`}
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
      <p className="city-popover__sub">Air-quality forecast from a computer model, not a measurement</p>

      <hr className="city-popover__rule" />
      <div className="city-popover__reading">
        {d.band && (
          <span className="city-popover__chip" style={{ '--band': d.band.color } as CSSProperties}>
            <span className="city-popover__dot" aria-hidden="true" />
            {d.band.label}
          </span>
        )}
        <span className="city-popover__big">{d.valueText}</span>
        <span className="city-popover__unit">
          {PM25_UNIT_WORDS}
          <span className="city-popover__when">{localTimeLabel(timeISO, where, { utc: false })}</span>
        </span>
      </div>
      <p className="city-popover__meaning">{d.sentence}</p>

      {spark && (
        <>
          <hr className="city-popover__rule" />
          <p className="city-popover__section">
            {snapshot ? '48 hours from the saved run' : 'Next 48 hours'} <span className="city-popover__tag">Modelled</span>
          </p>
          <figure className="city-popover__spark">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              role="img"
              aria-label={`Modelled PM2.5 for 48 hours: ${group(spark.first.v)} to ${group(spark.last.v)} µg/m³, highest ${group(spark.peak.v)} at ${localTimeLabel(isoOf(spark.peak.ms), where)}.`}
            >
              <path className="city-popover__area" d={spark.area} />
              {spark.whoY !== null && <line className="city-popover__guide" x1={PAD.l} x2={W - PAD.r} y1={spark.whoY} y2={spark.whoY} />}
              <line className="city-popover__axis" x1={PAD.l} x2={W - PAD.r} y1={spark.baseY} y2={spark.baseY} />
              <path className="city-popover__line" d={spark.line} />
              {spark.sel && <circle className="city-popover__sel" cx={spark.sel.x} cy={spark.sel.y} r={3.5} />}
              <text className="city-popover__tick" x={PAD.l} y={H - 2}>
                {snapshot ? 'Saved run' : 'Now'}
              </text>
              <text className="city-popover__tick" x={W / 2} y={H - 2} textAnchor="middle">
                +24 h
              </text>
              <text className="city-popover__tick" x={W - PAD.r} y={H - 2} textAnchor="end">
                +48 h
              </text>
              {spark.whoY !== null && (
                <text className="city-popover__tick" x={W - PAD.r} y={spark.whoY - 2} textAnchor="end">
                  WHO {WHO_PM25_24H_UGM3}
                </text>
              )}
            </svg>
          </figure>
          <p className="city-popover__worst">
            Worst: {localTimeLabel(isoOf(spark.peak.ms), where)} · {group(spark.peak.v)} µg/m³
          </p>
        </>
      )}

      <hr className="city-popover__rule" />
      <p className="city-popover__trust">
        <InfoIcon />
        <span>
          The model works in ~45 km squares, so this is the area around {area}, not your street.{' '}
          {snapshot ? `Saved model run from ${runLocal}.` : `Updated ${runLocal}.`}
        </span>
      </p>
      <p className="city-popover__official">
        Official readings and advice:{' '}
        {official ? (
          <ExternalLink href={official.url}>{official.label}</ExternalLink>
        ) : (
          <>check {COUNTRY_NAME[place.country] ?? 'the country'}&apos;s national environment agency.</>
        )}
      </p>
      {isSg && neaHaze && psiMax !== null && (
        <p className="city-popover__nea">
          <span className="city-popover__nea-tag">Measured by NEA</span> 24-hour PSI {psiMax}, {neaHaze.psiBand} ·{' '}
          {neaHaze.dataMode === 'historical' ? 'saved reading from ' : ''}
          {localTimeLabel(neaHaze.observedAt, where, { utc: false })}
        </p>
      )}

      <details className="city-popover__about">
        <summary>About this data</summary>
        <ul>
          <li>
            Model: {airQuality.model}, through the{' '}
            <ExternalLink href={airQuality.sourceUrl}>{airQuality.source}</ExternalLink>. {airQuality.attribution}
          </li>
          <li>
            Model run: {snapshot ? 'saved snapshot captured' : 'live, retrieved'} {utc(airQuality.retrievedAt)}. Hour shown:{' '}
            {utc(timeISO)} ({Number(value.toFixed(1))} µg/m³, between model hours where needed).
          </li>
          <li>Colour bands: {PM25_BANDS_NOTE}</li>
          <li>
            The WHO comparison sets an hourly model value against a 24-hour guideline ({WHO_PM25_24H_UGM3} µg/m³, WHO 2021): a sense of
            scale, not a measured exceedance.
          </li>
        </ul>
      </details>
    </div>
  );
}
