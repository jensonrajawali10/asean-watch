// The one map timeline (docs/UX_V3.md section 2): the forecast hour from −24 h to +48 h in 3-hourly steps,
// with play, a strip of worst-city bars (highest MODELLED PM2.5 among the haze cities at each step; click a
// bar to jump there), a compact PM2.5 colour key and the MODELLED label. It drives the haze, the wind
// particles, the city circles and the ash scenario. Play state lives in useHazeHour (App), so the volcano
// card's "Play ash scenario" runs the same timeline. Not the seven-day evidence replay (workspace).
import { useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { PM25_BANDS, pm25Band, worstPlaceByStep } from '../../lib/airQuality';
import type { AirQualityData, ForecastSteps } from '../../lib/airQuality';
import './HazeScrubber.css';

export interface HazeScrubberProps {
  steps: ForecastSteps;
  index: number;
  onIndexChange: (index: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** For the worst-city strip and the run/snapshot tag. */
  airQuality: AirQualityData | null;
  /** Phone layout: two rows, no colour key. */
  compact?: boolean;
  /** True while the ash scenario follows this timeline. */
  scenario?: boolean;
  className?: string;
}

const STRIP_H = 30;

const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const clean = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

/** "Thu 00:00" in UTC. */
function shortHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)}`;
}

/** "Thu 16 Oct 00:00 UTC". */
function longHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)} UTC`;
}

/** "now", "now +6 h", "saved run −3 h". A snapshot's anchor is its capture time: never "now". */
function offsetLabel(offsetH: number, snapshot: boolean): string {
  const base = snapshot ? 'saved run' : 'now';
  return offsetH === 0 ? base : `${base} ${signed(offsetH)} h`;
}

/** "Worst at Thu 00:00: Palangka Raya, 604 µg/m³" (MODELLED). */
function worstLine(w: { place: { name: string }; pm25: number; timeISO: string } | null | undefined): string {
  if (!w || !Number.isFinite(w.pm25)) return 'Worst city: no air-quality data yet';
  return `Worst at ${shortHour(w.timeISO)}: ${clean(w.place.name)}, ${Math.round(w.pm25).toLocaleString('en-US')} µg/m³`;
}

export default function HazeScrubber({ steps, index, onIndexChange, playing, onPlayingChange, airQuality, compact = false, scenario = false, className }: HazeScrubberProps) {
  const [peek, setPeek] = useState<number | null>(null);
  const titleId = useId();
  const barRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = steps.times.length;
  const last = Math.max(0, n - 1);
  const snapshot = airQuality?.dataMode === 'historical';

  const worst = useMemo(() => worstPlaceByStep(airQuality, steps.times), [airQuality, steps]);
  // Heights on a log scale between the series' own min and max (floor 15 µg/m³), so hour-to-hour change reads.
  const scale = useMemo(() => {
    const vals = worst.map((w) => Math.log(Math.max(15, w.pm25)));
    const lo = Math.min(...vals, Math.log(15));
    const hi = Math.max(...vals, lo + Math.log(2));
    return { lo, hi };
  }, [worst]);
  const top = useMemo(() => worst.reduce<(typeof worst)[number] | null>((m, w) => (!m || w.pm25 > m.pm25 ? w : m), null), [worst]);

  const offset = steps.offsetsH[index] ?? 0;
  const time = steps.times[index] ?? '';
  const shown = peek ?? index;
  const readout = worstLine(worst[shown]);
  const runText = airQuality ? `${snapshot ? 'Saved run' : 'Model run'} ${longHour(airQuality.retrievedAt).replace(/^\w+ /, '')}` : 'Loading the model…';

  const onBarKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const to = e.key === 'ArrowRight' ? k + 1 : e.key === 'ArrowLeft' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const t = Math.max(0, Math.min(last, to));
    barRefs.current[t]?.focus();
    onIndexChange(t);
  };

  return (
    <section
      className={`hscrub${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      data-no-pan
      style={{ '--steps': Math.max(1, n) } as CSSProperties}
    >
      <button
        type="button"
        className="hscrub__play"
        aria-pressed={playing}
        aria-label={playing ? 'Pause the forecast' : 'Play the forecast'}
        title={playing ? 'Pause' : 'Play the next 48 hours'}
        onClick={() => onPlayingChange(!playing)}
        disabled={n < 2}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4.5 2.5v11l9-5.5z" />}
        </svg>
      </button>

      <div className="hscrub__info">
        <h2 id={titleId} className="hscrub__title">
          <span>Haze forecast</span>
          <span className="hscrub__tag">MODELLED</span>
          {snapshot && <span className="hscrub__tag is-saved">SAVED</span>}
        </h2>
        <p className="hscrub__time" aria-live="polite">
          <time dateTime={time}>{time ? longHour(time) : '—'}</time> <span className="hscrub__offset">· {offsetLabel(offset, snapshot)}</span>
        </p>
        {!compact && <p className="hscrub__readout">{readout}</p>}
      </div>

      <div className="hscrub__track">
        <div
          className="hscrub__strip"
          role="group"
          aria-label={
            top
              ? `Worst city at each 3-hour step (modelled). Highest: ${clean(top.place.name)} ${Math.round(top.pm25)} µg/m³ at ${longHour(top.timeISO)}.`
              : 'Worst city at each 3-hour step (modelled): no air-quality data.'
          }
          style={{ height: STRIP_H }}
          onMouseLeave={() => setPeek(null)}
        >
          {worst.map((w, k) => {
            const band = pm25Band(w.pm25);
            const h = Math.round(4 + ((Math.log(Math.max(15, w.pm25)) - scale.lo) / (scale.hi - scale.lo)) * (STRIP_H - 4));
            return (
              <button
                key={w.timeISO}
                ref={(el) => {
                  barRefs.current[k] = el;
                }}
                type="button"
                className={`hscrub__bar${k === index ? ' is-current' : ''}${k < steps.nowIndex ? ' is-past' : ''}`}
                tabIndex={k === index ? 0 : -1}
                aria-label={`${worstLine(w)}${band ? `, ${band.label}` : ''}. Show this hour.`}
                onMouseEnter={() => setPeek(k)}
                onFocus={() => setPeek(k)}
                onBlur={() => setPeek(null)}
                onKeyDown={(e) => onBarKey(e, k)}
                onClick={() => onIndexChange(k)}
              >
                <span style={{ height: h, '--band': band?.color ?? 'var(--border-strong)' } as CSSProperties} />
              </button>
            );
          })}
          {steps.nowIndex > 0 && steps.nowIndex < last && (
            <span className="hscrub__now-line" style={{ left: `calc(${(steps.nowIndex + 0.5) * (100 / Math.max(1, n))}%)` }} aria-hidden="true" />
          )}
        </div>
        <input
          className="hscrub__range"
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          onChange={(e) => onIndexChange(Number(e.currentTarget.value))}
          aria-label="Forecast hour, 3-hourly steps"
          aria-valuetext={`${offsetLabel(offset, snapshot)}, ${time ? longHour(time) : ''}`}
          disabled={n < 2}
          style={{ '--fill': `${n > 1 ? (index / last) * 100 : 0}%` } as CSSProperties}
        />
        <div className="hscrub__ticks" aria-hidden="true">
          <span>{signed(steps.offsetsH[0] ?? 0)} h</span>
          {index !== steps.nowIndex ? (
            <button type="button" className="hscrub__jump" onClick={() => onIndexChange(steps.nowIndex)}>
              {snapshot ? 'Back to the run' : 'Back to now'}
            </button>
          ) : (
            <span className="hscrub__nowword">{snapshot ? 'saved run' : 'now'}</span>
          )}
          <span>{signed(steps.offsetsH[last] ?? 0)} h</span>
        </div>
      </div>

      {!compact && (
        <div className="hscrub__key" aria-label="PM2.5 colour key, µg/m³, US EPA-style bands on modelled values">
          <p className="hscrub__key-title">PM2.5 µg/m³</p>
          <ol>
            {PM25_BANDS.map((b) => (
              <li key={b.key} title={b.label}>
                <span className="hscrub__swatch" style={{ '--band': b.color } as CSSProperties} aria-hidden="true" />
                <span className="hscrub__key-v">{b.min}</span>
                <span className="visually-hidden">{b.label}</span>
              </li>
            ))}
          </ol>
          <p className="hscrub__run">{scenario ? 'Ash scenario follows this timeline' : runText}</p>
        </div>
      )}
      {compact && <p className="hscrub__readout is-compact">{readout}</p>}
    </section>
  );
}
