// The slim icon rail on the left edge of map mode (docs/UX_V3.md section 2). Map closes the workspace;
// every other icon opens its section in the drawer. Always visible; a horizontal bar on phones (shell.css).
// Each button carries its name for assistive tech and a tooltip for everyone else.
// First visit (desktop): a one-time callout beside the rail says what the buttons open, because hover hints
// do not show in a still view and the rail read as decoration. It goes away for good on "Got it" or as soon
// as any section is opened.
import { useEffect, useState } from 'react';
import { MapIcon, SECTION_ICONS } from './icons';
import { markRailHintSeen, RAIL_HINT_TEXT, RAIL_HINT_TITLE, railHintSeen, railHintShown } from './railHint';
import { SECTIONS, taskbarButtonId } from './workspace';
import type { SectionId } from './workspace';

export interface TaskbarProps {
  /** The open section, or null in map mode. */
  active: SectionId | null;
  onOpen: (section: SectionId) => void;
  onMap: () => void;
  /** Number badge on the Warnings icon (active official messages), with `urgent` turning it red. */
  alerts?: { count: number; urgent: boolean } | null;
}

export default function Taskbar({ active, onOpen, onMap, alerts = null }: TaskbarProps) {
  const [seen, setSeen] = useState(() => (typeof window === 'undefined' ? false : railHintSeen()));
  // Opening any section (from the rail, the alerts pill or a card) counts as having found the rail.
  if (!seen && active !== null) setSeen(true);
  useEffect(() => {
    if (seen) markRailHintSeen();
  }, [seen]);
  return (
    <nav className="taskbar" aria-label="Data and report sections">
      <ul className="taskbar__list">
        <li>
          <button
            id={taskbarButtonId('map')}
            type="button"
            className={`taskbar__btn${active === null ? ' is-active' : ''}`}
            aria-current={active === null ? 'page' : undefined}
            aria-label="Map"
            title="Map: close Data & reports"
            onClick={onMap}
          >
            <MapIcon />
            <span className="taskbar__label">Map</span>
          </button>
        </li>
        {SECTIONS.map((s) => {
          const Icon = SECTION_ICONS[s.id];
          const isActive = active === s.id;
          const badge = s.id === 'warnings' && alerts && alerts.count > 0 ? alerts : null;
          return (
            <li key={s.id}>
              <button
                id={taskbarButtonId(s.id)}
                type="button"
                className={`taskbar__btn${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={badge ? `${s.label} (${badge.count} active official ${badge.count === 1 ? 'message' : 'messages'})` : s.label}
                aria-describedby={`${taskbarButtonId(s.id)}-hint`}
                onClick={() => onOpen(s.id)}
              >
                <Icon />
                <span className="taskbar__label">{s.label}</span>
                <span id={`${taskbarButtonId(s.id)}-hint`} className="taskbar__hint" role="tooltip">
                  <strong>{s.title}</strong> {s.hint}
                </span>
                {badge && (
                  <span className={`taskbar__badge${badge.urgent ? ' is-urgent' : ''}`} aria-hidden="true">
                    {badge.count > 99 ? '99+' : badge.count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {railHintShown(seen, active) && (
        <aside className="rail-callout" aria-label="What the buttons on the left open">
          <p>
            <strong>{RAIL_HINT_TITLE}</strong> {RAIL_HINT_TEXT}
          </p>
          <button type="button" className="rail-callout__ok" onClick={() => setSeen(true)}>
            Got it
          </button>
        </aside>
      )}
    </nav>
  );
}
