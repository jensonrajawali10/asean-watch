// Compact app header: brand, workspace, and the persistent DEMO REPLAY label.
// Publishes its height as --header-h so the record inspector can open below it (the label stays visible).
import { useLayoutEffect, useRef } from 'react';

export default function AppHeader() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="app-header" ref={ref}>
      <div className="brand">
        <h1 className="brand-name">ASEAN Watch</h1>
        <span className="workspace-label">
          <span className="visually-hidden">Workspace: </span>
          Environment
        </span>
      </div>
      <p className="demo-label" role="note">
        <strong>DEMO REPLAY</strong> · scenario records simulated · not an official warning
      </p>
    </header>
  );
}
