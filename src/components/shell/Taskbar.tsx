// The slim icon rail on the left edge of map mode (docs/UX_V3.md section 2). Map closes the workspace;
// every other icon opens its section in the drawer. Always visible; a horizontal bar on phones (shell.css).
// Each button carries its name for assistive tech and a tooltip for everyone else.
import { MapIcon, SECTION_ICONS } from './icons';
import { SECTIONS } from './workspace';
import type { SectionId } from './workspace';

export interface TaskbarProps {
  /** The open section, or null in map mode. */
  active: SectionId | null;
  onOpen: (section: SectionId) => void;
  onMap: () => void;
  /** Number badge on the Warnings icon (active official messages), with `urgent` turning it red. */
  alerts?: { count: number; urgent: boolean } | null;
}

/** Element id of a taskbar button, so the drawer can return focus to it. */
export function taskbarButtonId(section: SectionId | 'map'): string {
  return `taskbar-${section}`;
}

export default function Taskbar({ active, onOpen, onMap, alerts = null }: TaskbarProps) {
  return (
    <nav className="taskbar" aria-label="Workspace sections">
      <ul className="taskbar__list">
        <li>
          <button
            id={taskbarButtonId('map')}
            type="button"
            className={`taskbar__btn${active === null ? ' is-active' : ''}`}
            aria-current={active === null ? 'page' : undefined}
            aria-label="Map"
            title="Map: close the workspace"
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
    </nav>
  );
}
