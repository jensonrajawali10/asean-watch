// Compact forecast-hour control for the modelled haze and wind layers: now −24 h … +48 h in 3-hourly
// steps, play/pause, a drag slider, and a "worst city each hour" strip (highest MODELLED PM2.5 among
// AQ_PLACES per step; click a bar to jump there). Not the evidence replay timeline.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { pm25Band, worstPlaceByStep } from '../../lib/airQuality';
import type { AirQualityData, ForecastSteps } from '../../lib/airQuality';
import './HazeScrubber.css';

export interface HazeScrubberProps {
  steps: ForecastSteps;
  index: number;
  onIndexChange: (index: number) => void;
  /** For the worst-city strip and the run/snapshot tag. */
  airQuality: AirQualityData | null;
  /** Dark panel variant to match the dark map. */
  dark?: boolean;
  className?: string;
}

const PLAY_MS = 900;
const STRIP_H = 24;
/** Half the range thumb width (CSS), so bar k sits exactly above thumb position k. */
const THUMB_HALF = 8;

const minus = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
function offsetLabel(h: number): string {
  return h === 0 ? 'now' : `now ${minus(h)} h`;
}
function utcLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day} ${iso.slice(11, 16)} UTC`;
}

export default function HazeScrubber({ steps, index, onIndexChange, airQuality, dark = false, className }: HazeScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const [peek, setPeek] = useState<number | null>(null);
  const titleId = useId();
  const stripId = useId();
  const barRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = steps.times.length;
  const last = Math.max(0, n - 1);

  // Play advances one step per tick and loops; the index lives in the parent, so read it through a ref.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    if (!playing || n < 2) return;
    const id = window.setInterval(() => onIndexChange(indexRef.current >= last ? 0 : indexRef.current + 1), PLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, n, last, onIndexChange]);

  const worst = useMemo(() => worstPlaceByStep(airQuality, steps.times), [airQuality, steps]);
  // Heights on a log scale between the series' own min and max (floor 15 µg/m³), so hour-to-hour change reads.
  const scale = useMemo(() => {
    const vals = worst.map((w) => Math.log(Math.max(15, w.pm25)));
    const lo = Math.min(...vals, Math.log(15));
    const hi = Math.max(...vals, lo + Math.log(2));
    return { lo, hi };
  }, [worst]);
  const top = useMemo(() => worst.reduce<(typeof worst)[number] | null>((m, w) => (!m || w.pm25 > m.pm25 ? w : m), null), [worst]);
  const worstText = (k: number) => {
    const w = worst[k];
    return w ? `${w.place.name} ${Math.round(w.pm25)} µg/m³ (modelled) · ${utcLabel(w.timeISO)}` : '';
  };
  const stripLabel = top
    ? `MODELLED worst city each hour. Highest: ${top.place.name} ${Math.round(top.pm25)} µg/m³ at ${utcLabel(top.timeISO)}.`
    : 'MODELLED worst city each hour: no air-quality data.';

  const offset = steps.offsetsH[index] ?? 0;
  const time = steps.times[index] ?? '';
  const mode = airQuality?.dataMode === 'historical' ? 'SNAPSHOT' : airQuality ? 'LIVE' : null;
  const readout = peek !== null ? worstText(peek) : worstText(index);

  const onBarKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const to = e.key === 'ArrowRight' ? k + 1 : e.key === 'ArrowLeft' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const t = Math.max(0, Math.min(last, to));
    barRefs.current[t]?.focus();
  };

  return (
    <section
      className={`haze-scrubber${dark ? ' is-dark' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      data-no-pan
    >
      <div className="haze-scrubber__head">
        <button
          type="button"
          className="haze-scrubber__play"
          aria-pressed={playing}
          aria-label={playing ? 'Pause the forecast animation' : 'Play the forecast animation'}
          onClick={() => setPlaying((p) => !p)}
          disabled={n < 2}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4.5 2.5v11l9-5.5z" />}
          </svg>
        </button>
        <div className="haze-scrubber__title">
          <h2 id={titleId}>
            Haze &amp; wind model: now {'−'}24 h … +48 h
          </h2>
          <p className="haze-scrubber__now" aria-live="polite">
            <strong>{offsetLabel(offset)}</strong> · <time dateTime={time}>{time ? utcLabel(time) : '—'}</time>
          </p>
        </div>
        {index !== steps.nowIndex && (
          <button type="button" className="haze-scrubber__jump" onClick={() => onIndexChange(steps.nowIndex)}>
            Now
          </button>
        )}
      </div>

      <div className="haze-scrubber__track">
        <div
          id={stripId}
          className="haze-scrubber__strip"
          role="group"
          aria-label={stripLabel}
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
                className={`haze-scrubber__bar${k === index ? ' is-current' : ''}`}
                style={{
                  left: `calc(${THUMB_HALF}px + (100% - ${2 * THUMB_HALF}px) * ${n > 1 ? k / last : 0.5})`,
                  width: `max(3px, calc((100% - ${2 * THUMB_HALF}px) / ${Math.max(1, last)} - 2px))`,
                }}
                tabIndex={k === index ? 0 : -1}
                aria-label={`${worstText(k)}${band ? `, ${band.label}` : ''}. Jump to this hour.`}
                onMouseEnter={() => setPeek(k)}
                onFocus={() => setPeek(k)}
                onBlur={() => setPeek(null)}
                onKeyDown={(e) => onBarKey(e, k)}
                onClick={() => onIndexChange(k)}
              >
                <span style={{ height: h, background: band?.color ?? 'var(--border-strong)' }} />
              </button>
            );
          })}
        </div>
        <input
          className="haze-scrubber__range"
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          onChange={(e) => onIndexChange(Number(e.currentTarget.value))}
          aria-label="Forecast hour (3-hourly steps)"
          aria-valuetext={`${offsetLabel(offset)}, ${time ? utcLabel(time) : ''}`}
          disabled={n < 2}
        />
        <div className="haze-scrubber__ticks" aria-hidden="true">
          <span style={{ left: 0 }}>{minus(steps.offsetsH[0] ?? 0)} h</span>
          {steps.nowIndex > 0 && steps.nowIndex < last && (
            <span
              className="is-mid"
              style={{ left: `calc(${THUMB_HALF}px + (100% - ${2 * THUMB_HALF}px) * ${steps.nowIndex / last})` }}
            >
              now
            </span>
          )}
          <span style={{ right: 0 }}>{minus(steps.offsetsH[last] ?? 0)} h</span>
        </div>
      </div>

      <p className="haze-scrubber__readout" aria-hidden="true">
        <span className="haze-scrubber__readout-k">Worst city</span> {readout || '—'}
      </p>
      <p className="haze-scrubber__note">
        <span className="haze-scrubber__badge">MODELLED</span> forecast (CAMS + Open-Meteo), not an official advisory
        {mode && airQuality && (
          <>
            {' · '}
            <span className="haze-scrubber__mode">
              {mode} run {airQuality.retrievedAt.slice(5, 10)} {airQuality.retrievedAt.slice(11, 16)} UTC
            </span>
          </>
        )}
      </p>
    </section>
  );
}
