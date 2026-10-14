// Compact app header: brand, workspace, and the persistent data-recency line. Publishes its measured
// height as --header-offset so the inspector drawers open below it (the recency line stays visible under
// a dialog). Nothing in the header's own styling reads that variable back (see App.css).
// The Dark / Light toggle writes <html data-theme> (read by index.css and the map), persists the choice
// in localStorage (index.html applies it before first paint) and fires 'aw:themechange' on window.
import { useLayoutEffect, useRef, useState } from 'react';
import { formatUtc } from './format';

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

export interface AppHeaderProps {
  /** ISO time the loaded observation snapshot was taken; null when unknown. */
  dataAsOf: string | null;
  /** False while any loaded record is still a simulated fixture (the line then says so). */
  allReal: boolean;
}

export default function AppHeader({ dataAsOf, allReal }: AppHeaderProps) {
  const ref = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

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

  const asOf = dataAsOf ? formatUtc(dataAsOf) : null;

  return (
    <header className="app-header" ref={ref}>
      <div className="brand">
        <h1 className="brand-name">ASEAN Watch</h1>
        <span className="workspace-label">
          <span className="visually-hidden">Workspace: </span>
          Environment
        </span>
      </div>
      <div className="theme-toggle" role="group" aria-label="Colour theme">
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => choose('dark')}>
          Dark
        </button>
        <button type="button" aria-pressed={theme === 'light'} onClick={() => choose('light')}>
          Light
        </button>
      </div>
      <p className="recency" role="note">
        <strong>{allReal ? 'Real data' : 'Demo data'}</strong>
        <span className="recency-long">
          {' · '}
          {allReal ? 'data as of' : 'simulated records'}
          {asOf && (
            <>
              {' '}
              <time dateTime={dataAsOf ?? undefined}>{asOf}</time>
            </>
          )}
          {' · official warnings relayed verbatim · not an official warning service'}
        </span>
        <span className="recency-short">
          {asOf && (
            <>
              {' · as of '}
              <time dateTime={dataAsOf ?? undefined}>{asOf}</time>
            </>
          )}
          {' · not an official warning service'}
        </span>
      </p>
    </header>
  );
}
