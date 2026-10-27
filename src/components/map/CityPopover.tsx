// City card for map mode (docs/UX_V3.md section 2), on the shared MapCard anatomy. The plain-language
// copy of the old city popover is kept: it is a forecast from a computer model, not a measurement; the band,
// the number and its unit in words; what the number means against the WHO 24-hour guideline; the next 48
// hours with the worst hour in local time; where the air is arriving from; how far to trust it; where the
// official word is (Singapore also shows NEA's MEASURED PSI, labelled apart).
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { HazeReading } from '../../types';
import { PM25_MEANING, UGM3_WORDS, WHO_PM25_24H_UGM3, describePm25, placePm25At, plainAirSentence } from '../../lib/airQuality';
import type { AirQualityData, Pm25Band } from '../../lib/airQuality';
import { AIR_QUALITY_OFFICIAL, COUNTRY_NAME, localTimeLabel, noPsiNote, placeRef } from '../../lib/places';
import type { WindGrid } from '../../lib/windField';
import { sampleWind } from '../../lib/transport';
import { MapCard } from '../ui/MapCard';
import type { FactTone } from '../ui/MapCard';
import { CityIcon } from '../shell/icons';
import { compassWord } from '../shell/headline';
import { ExternalLink } from './PopoverParts';
import './CityPopover.css';

export interface CityCardProps {
  cityId: string;
  airQuality: AirQualityData;
  /** The scrubber's selected hour. */
  timeISO: string;
  /** The scrubber's anchor step ("now", or the snapshot's capture hour): start of the 48 h chart. */
  nowISO: string;
  /** 925 hPa wind (modelled) for "air arriving from". */
  wind?: WindGrid | null;
  /** NEA measured haze; shown for Singapore only. */
  neaHaze?: HazeReading | null;
  onClose: () => void;
  onOpenWorkspace: () => void;
}

const W = 300;
const H = 54;
const PAD = { l: 2, r: 2, t: 6, b: 14 };
const HOUR = 3_600_000;

const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const group = (n: number) => Math.round(n).toLocaleString('en-US');
const clean = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

/** MapCard tone for a PM2.5 band. */
function bandTone(band: Pm25Band | null): FactTone {
  switch (band?.key) {
    case 'good':
      return 'good';
    case 'moderate':
      return 'moderate';
    case 'usg':
      return 'sensitive';
    case 'unhealthy':
      return 'unhealthy';
    case 'very-unhealthy':
    case 'hazardous':
      return 'very-unhealthy';
    default:
      return 'default';
  }
}

/** "Air arriving from the south-east (modelled wind about 800 m up)." or null when calm or unknown. */
function arrivingFrom(wind: { u: number; v: number } | null): string | null {
  if (!wind || !Number.isFinite(wind.u) || !Number.isFinite(wind.v)) return null;
  const speed = Math.hypot(wind.u, wind.v);
  if (speed < 1) return 'Winds about 800 m up are calm here, so smoke lingers (modelled).';
  // The wind blows TOWARD atan2(u, v); it arrives FROM the opposite bearing.
  const from = ((Math.atan2(wind.u, wind.v) * 180) / Math.PI + 180 + 360) % 360;
  return `Air is arriving from the ${compassWord(from)} (modelled wind about 800 m up, ${Math.round(speed * 3.6)} km/h).`;
}

export default function CityCard({ cityId, airQuality, timeISO, nowISO, wind = null, neaHaze, onClose, onOpenWorkspace }: CityCardProps) {
  const place = airQuality.places.find((p) => p.id === cityId) ?? null;

  const spark = useMemo(() => {
    if (!place) return null;
    const t0 = Date.parse(nowISO);
    const t1 = t0 + 48 * HOUR;
    const pts = airQuality.times.map((t, k) => ({ ms: Date.parse(t), v: place.pm25[k] })).filter((p) => p.ms >= t0 && p.ms <= t1 && Number.isFinite(p.v));
    if (pts.length < 2) return null;
    const vmax = Math.max(40, ...pts.map((p) => p.v)) * 1.08;
    const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1].ms).toFixed(1)} ${y(0).toFixed(1)} L${x(pts[0].ms).toFixed(1)} ${y(0).toFixed(1)} Z`;
    const peak = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]);
    const sel = Date.parse(timeISO);
    const selV = placePm25At(airQuality, place, timeISO);
    const whoY = WHO_PM25_24H_UGM3 / vmax > 0.12 ? y(WHO_PM25_24H_UGM3) : null;
    return {
      line,
      area,
      whoY,
      peak,
      first: pts[0],
      last: pts[pts.length - 1],
      sel: sel >= t0 && sel <= t1 && Number.isFinite(selV) ? { x: x(sel), y: y(selV) } : null,
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
  const name = clean(place.name);
  const arriving = arrivingFrom(wind ? sampleWind(wind, place.lat, place.lon, timeISO) : null);
  const at = localTimeLabel(timeISO, where, { utc: false });

  return (
    <MapCard
      className="city-card"
      icon={<CityIcon size={18} />}
      eyebrow={`${place.kind === 'fire-area' ? 'Fire-prone area' : 'City'} · ${COUNTRY_NAME[place.country] ?? place.country}`}
      title={name}
      kind="modelled"
      onClose={onClose}
      facts={[
        { label: 'Fine smoke (PM2.5)', value: d.valueText, unit: 'µg/m³', tone: bandTone(d.band), note: d.band ? d.band.label : at },
        { label: 'Times the WHO daily guideline', value: d.timesWho === null ? '—' : `${d.timesWho.toLocaleString('en-US')}×`, note: `guideline: ${WHO_PM25_24H_UGM3} µg/m³ over 24 h` },
        spark
          ? { label: snapshot ? 'Worst hour in the saved run' : 'Worst hour, next 48 h (forecast)', value: group(spark.peak.v), unit: 'µg/m³', note: localTimeLabel(isoOf(spark.peak.ms), where, { utc: false }) }
          : { label: 'Hour shown', value: at },
      ]}
      sentence={
        <>
          {plainAirSentence(name, value)}{' '}
          <span className="city-card__sub">
            A computer forecast for {at}, not a measurement. PM2.5 is {PM25_MEANING.charAt(0).toLowerCase() + PM25_MEANING.slice(1)} {UGM3_WORDS}
          </span>
        </>
      }
      action={{ label: 'Open full data', onClick: onOpenWorkspace, title: 'Haze & air section: the full city table and transport' }}
      source={
        <>
          The model works in ~45 km squares, so this is the area around {area}, not your street. CAMS via Open-Meteo,{' '}
          {snapshot ? `saved run from ${runLocal}` : `updated ${runLocal}`}.
        </>
      }
    >
      {arriving && <p className="city-card__line">{arriving}</p>}
      {spark && (
        <figure className="city-card__spark">
          <figcaption className="city-card__cap">
            {snapshot ? 'Fine smoke over 48 hours of the saved forecast run' : 'Fine smoke forecast for the next 48 hours'}, µg/m³ (dot: the hour shown)
          </figcaption>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Modelled PM2.5 for 48 hours: ${group(spark.first.v)} to ${group(spark.last.v)} µg/m³, highest ${group(spark.peak.v)} at ${localTimeLabel(isoOf(spark.peak.ms), where)}.`}
          >
            <path className="city-card__area" d={spark.area} style={{ '--band': d.band?.color ?? 'currentColor' } as CSSProperties} />
            {spark.whoY !== null && <line className="city-card__guide" x1={PAD.l} x2={W - PAD.r} y1={spark.whoY} y2={spark.whoY} />}
            <line className="city-card__axis" x1={PAD.l} x2={W - PAD.r} y1={spark.baseY} y2={spark.baseY} />
            <path className="city-card__trace" d={spark.line} />
            {spark.sel && <circle className="city-card__sel" cx={spark.sel.x} cy={spark.sel.y} r={3.5} />}
            <text className="city-card__tick" x={PAD.l} y={H - 2}>
              {snapshot ? 'Run' : 'Now'}
            </text>
            <text className="city-card__tick" x={W / 2} y={H - 2} textAnchor="middle">
              +24 h
            </text>
            <text className="city-card__tick" x={W - PAD.r} y={H - 2} textAnchor="end">
              +48 h
            </text>
            {spark.whoY !== null && (
              <text className="city-card__tick" x={W - PAD.r} y={spark.whoY - 2} textAnchor="end">
                WHO {WHO_PM25_24H_UGM3}
              </text>
            )}
          </svg>
        </figure>
      )}
      {isSg && neaHaze && psiMax !== null && (
        <p className="city-card__line">
          <span className="city-card__measured">Measured by NEA</span> 24-hour PSI {psiMax}, {neaHaze.psiBand} ·{' '}
          {neaHaze.dataMode === 'historical' ? 'saved reading from ' : ''}
          {localTimeLabel(neaHaze.observedAt, where, { utc: false })}
        </p>
      )}
      {noPsiNote(place.country) && <p className="city-card__line city-card__muted">{noPsiNote(place.country)}</p>}
      <p className="city-card__line">
        Official readings and advice:{' '}
        {official ? (
          <ExternalLink href={official.url}>{official.label}</ExternalLink>
        ) : (
          <>check {COUNTRY_NAME[place.country] ?? 'the country'}&apos;s national environment agency.</>
        )}
      </p>
    </MapCard>
  );
}
