// Compact app header: brand, workspace, and the persistent data-recency line. Publishes its measured
// height as --header-offset so the inspector drawers open below it (the recency line stays visible under
// a dialog). Nothing in the header's own styling reads that variable back (see App.css).
import { useLayoutEffect, useRef } from 'react';
import { formatUtc } from './format';

export interface AppHeaderProps {
  /** ISO time the loaded observation snapshot was taken; null when unknown. */
  dataAsOf: string | null;
  /** False while any loaded record is still a simulated fixture (the line then says so). */
  allReal: boolean;
}

export default function AppHeader({ dataAsOf, allReal }: AppHeaderProps) {
  const ref = useRef<HTMLElement>(null);

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
