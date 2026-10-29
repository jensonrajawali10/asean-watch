// The floating top bar of map mode (docs/UX_V3.md section 2). Left: the brand block and one live headline
// sentence with the time and a freshness chip. Right: the Official-alerts pill (red when a tsunami or
// evacuation-level message is in force), the Dark / Light toggle and the Workspace button.
// Publishes its measured height as --header-offset so the inspector drawers open below it.
// The theme toggle writes <html data-theme> (read by index.css and the map), persists the choice in
// localStorage (index.html applies it before first paint) and fires 'aw:themechange' on window.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { WarningIcon, LayersIcon } from './shell/icons';
import { applyDetail, useDetailMode } from '../lib/detailMode';
import { localTimeLabel } from './localTime';

export type Theme = 'dark' | 'light';
/** localStorage key; index.html's pre-paint script reads the same key. */
export const THEME_STORAGE_KEY = 'aw-theme';

function readTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, policy): the choice still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent<Theme>('aw:themechange', { detail: theme }));
}

/** The first-load legend: what each symbol on the map is (long on desktop, short on phones). */
const HEADLINE_LEGEND = [
  { sym: 'circle', long: 'Circles: fine smoke forecast (PM2.5, modelled)', short: 'Smoke forecast, not sensors' },
  { sym: 'fire', long: 'Orange squares: fires seen by NASA satellites', short: 'Fires (NASA)' },
  { sym: 'volcano', long: 'Triangles: volcanoes', short: 'Volcanoes' },
  { sym: 'pin', long: 'Red pins: official warnings', short: 'Warnings' },
  { sym: 'wind', long: 'Streaks: wind (forecast)', short: 'Wind' },
] as const;

/**
 * "24 Oct 07:56 UTC" with the date in its own span, so phones can show a LIVE chip as "LIVE · 07:56 UTC"
 * beside the hour (a saved copy always keeps its date).
 */
function RunTime({ run }: { run: string }) {
  const m = /^(.*\S)\s+(\d{2}:\d{2} UTC)$/.exec(run);
  if (!m) return <>{run}</>;
  return (
    <>
      <span className="fresh-chip__date">{m[1]} </span>
      {m[2]}
    </>
  );
}

export interface AppHeaderProps {
  /** One live sentence built from the data, e.g. "Now: haze is worst over Palangka Raya (604 µg/m³, modelled)." */
  headline: string;
  /** The hour the map shows, e.g. "Thu 16 Oct 00:00 UTC". */
  timeLabel: string | null;
  /** ISO time behind `timeLabel`, for the <time> element. */
  timeISO: string | null;
  /**
   * LIVE or SNAPSHOT with the run time; null while nothing has loaded. `older` is set when the run is past
   * its expected update interval (src/lib/staleness.ts): the sentence, and a short form for phones.
   */
  freshness: { mode: 'LIVE' | 'SNAPSHOT'; run: string | null; older?: { text: string; short: string } | null } | null;
  alerts: { count: number; urgent: boolean; label: string };
  onAlerts: () => void;
  workspaceOpen: boolean;
  onWorkspace: () => void;
  /** Extra content under the headline (e.g. a data-check notice). */
  children?: ReactNode;
}

export default function AppHeader({ headline, timeLabel, timeISO, freshness, alerts, onAlerts, workspaceOpen, onWorkspace, children }: AppHeaderProps) {
  const ref = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  // Simple view by default; "Show details" brings back the advanced parts (src/lib/detailMode.ts).
  const detail = useDetailMode();
  useLayoutEffect(() => {
    document.documentElement.dataset.detail = detail;
  }, [detail]);
  const toggleDetail = () => applyDetail(detail === 'simple' ? 'full' : 'simple');

  // The attribute is always present (dark when the pre-paint script did not run).
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme !== 'light' && root.dataset.theme !== 'dark') root.dataset.theme = 'dark';
  }, []);

  const choose = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    applyTheme(next);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--header-offset', `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <div className="topbar__left">
        <div className="brand">
          <h1 className="brand-name">ASEAN Watch</h1>
          <p className="brand-line">
            A smoke forecast, NASA fire detections and official warnings in the agencies&rsquo; own words
            <span className="brand-line__region">, across South-east Asia</span>.
          </p>
          <details className="brand-about">
            <summary>What is this?</summary>
            <p className="brand-tag">
              A map of haze, fires and volcanoes across South-east Asia. Coloured circles are a computer forecast of fine smoke
              (PM2.5) in the air; small orange squares are fires seen by NASA satellites; red pins are warnings from national
              agencies, shown word for word. ASEAN Watch never issues warnings of its own.
            </p>
          </details>
        </div>
        <p className="headline" aria-live="polite">
          {headline}
        </p>
        {/* What the symbols mean, on first load, without opening anything (the map key has the detail).
            Phones show the short words in one line; the long ones stay for screen readers there too. */}
        <p className="headline-legend">
          {HEADLINE_LEGEND.map((item) => (
            <span key={item.sym}>
              <i className={`hl-sym hl-sym--${item.sym}`} aria-hidden="true" />
              <span className="hl-long">{item.long}</span>
              <span className="hl-short" aria-hidden="true">
                {item.short}
              </span>
            </span>
          ))}
        </p>
        {/* The hour on the map, whether the forecast was fetched now (LIVE) or is a saved copy (SNAPSHOT), and
            the disclaimer, each in words a newcomer can read without hovering. */}
        <p className="headline-meta">
          {timeLabel && (
            <span>
              Map shows{' '}
              {localTimeLabel(timeISO) ? (
                <>
                  <span className="headline-local">{localTimeLabel(timeISO)}</span>
                  <span className="headline-utc">
                    {' '}
                    (<time dateTime={timeISO ?? undefined}>{timeLabel}</time>)
                  </span>
                </>
              ) : (
                <time dateTime={timeISO ?? undefined}>{timeLabel}</time>
              )}
            </span>
          )}
          {freshness && (
            <span
              className={`fresh-chip${freshness.mode === 'SNAPSHOT' ? ' is-snapshot' : ' is-live'}`}
              title={freshness.mode === 'SNAPSHOT' ? `Bundled snapshot of the model run captured ${freshness.run ?? ''}` : `Model run retrieved ${freshness.run ?? ''}`}
            >
              {freshness.mode}
              {freshness.run && (
                <span className="fresh-chip__run">
                  {' '}
                  · <span className="fresh-chip__verb">{freshness.mode === 'SNAPSHOT' ? 'saved' : 'fetched'} </span>
                  <RunTime run={freshness.run} />
                </span>
              )}
            </span>
          )}
          {/* Past the forecast's expected update interval: words in a dashed outline, never a colour alone. */}
          {freshness?.older && (
            <span className="fresh-chip is-older" title={freshness.older.text}>
              <span className="fresh-chip__older-long">{freshness.older.text}</span>
              <span className="fresh-chip__older-short" aria-hidden="true">
                {freshness.older.short}
              </span>
            </span>
          )}
          <span className="headline-note">Not an official warning service: follow your national agency.</span>
        </p>
        {children}
      </div>
      <div className="topbar__right">
        <button
          type="button"
          className="detail-toggle"
          aria-pressed={detail === 'full'}
          onClick={toggleDetail}
          title={detail === 'full' ? 'Back to the simple view' : 'Show the forecast timeline, fire counts, data links and theme'}
        >
          {/* Phones show the one-word label so the button and the messages pill fit beside the name. */}
          <span className="detail-toggle__long">{detail === 'full' ? 'Simple view' : 'Show details'}</span>
          <span className="detail-toggle__short">{detail === 'full' ? 'Simple' : 'Details'}</span>
        </button>
        <button
          type="button"
          className={`alerts-pill${alerts.urgent ? ' is-urgent' : ''}${alerts.count === 0 ? ' is-empty' : ''}`}
          onClick={onAlerts}
          title={
            alerts.urgent
              ? `${alerts.count} ${alerts.label}, including a tsunami or evacuation-level message. Open the official warnings.`
              : `${alerts.count} ${alerts.label}. Open the official warnings.`
          }
        >
          <WarningIcon size={16} />
          <span className="alerts-pill__count">{alerts.count}</span>
          {/* Phones hide the long words: the number still says what it counts. */}
          <span className="alerts-pill__short" aria-hidden="true">
            {alerts.count === 1 ? 'message' : 'messages'}
          </span>
          <span className="alerts-pill__text">
            {/* The red pill already signals urgency; the words say what the alerts are, plus "urgent" when one is. */}
            {alerts.urgent ? `${alerts.label} (incl. urgent)` : alerts.label}
          </span>
        </button>
        <div className="theme-toggle" role="group" aria-label="Colour theme">
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => choose('dark')}>
            Dark
          </button>
          <button type="button" aria-pressed={theme === 'light'} onClick={() => choose('light')}>
            Light
          </button>
        </div>
        <button type="button" className="ws-button" aria-pressed={workspaceOpen} onClick={onWorkspace} title="Open the data tables and reports">
          <LayersIcon size={16} />
          <span>Data &amp; reports</span>
        </button>
      </div>
    </header>
  );
}
