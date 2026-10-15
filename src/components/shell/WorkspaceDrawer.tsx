// The analyst workspace drawer (docs/UX_V3.md section 3): 480 to 560 px sliding over the left of the map,
// a full-height sheet under 768 px. Sticky header with the section title and section tabs; the body
// scrolls. Esc closes it; focus moves to the heading on open and back to the taskbar on close.
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CloseIcon, SECTION_ICONS } from './icons';
import { taskbarButtonId } from './Taskbar';
import { SECTIONS, sectionById } from './workspace';
import type { SectionId } from './workspace';

export interface WorkspaceDrawerProps {
  section: SectionId | null;
  onSelectSection: (section: SectionId) => void;
  onClose: () => void;
  /** Small line under the title, e.g. the selected watch area. */
  subtitle?: ReactNode;
  children: ReactNode;
}

export default function WorkspaceDrawer({ section, onSelectSection, onClose, subtitle, children }: WorkspaceDrawerProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastSection = useRef<SectionId | null>(null);
  const open = section !== null;

  // Focus the heading when the drawer opens or changes section; scroll the body to the top.
  useEffect(() => {
    if (!section) return;
    headingRef.current?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo({ top: 0 });
    lastSection.current = section;
  }, [section]);

  const close = () => {
    const back = lastSection.current ? document.getElementById(taskbarButtonId(lastSection.current)) : null;
    onClose();
    (back ?? document.getElementById(taskbarButtonId('map')))?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-no-pan] [role="dialog"]')) return;
    e.preventDefault();
    close();
  };

  const def = section ? sectionById(section) : null;

  return (
    <aside
      className="ws-drawer"
      data-open={open ? 'true' : 'false'}
      aria-labelledby="ws-drawer-title"
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      onKeyDown={onKeyDown}
    >
      <header className="ws-drawer__head">
        <div className="ws-drawer__titles">
          <p className="ws-drawer__eyebrow">Analyst workspace</p>
          <h2 id="ws-drawer-title" className="ws-drawer__title" ref={headingRef} tabIndex={-1}>
            {def?.title ?? 'Workspace'}
          </h2>
          {subtitle && <p className="ws-drawer__subtitle">{subtitle}</p>}
        </div>
        <button type="button" className="ws-drawer__close" onClick={close} aria-label="Close the workspace (Esc)" title="Close (Esc)">
          <CloseIcon />
        </button>
        <nav className="ws-tabs" aria-label="Sections">
          {SECTIONS.map((s) => {
            const Icon = SECTION_ICONS[s.id];
            const isActive = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                className={`ws-tab${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectSection(s.id)}
              >
                <Icon size={14} />
                {s.label}
              </button>
            );
          })}
        </nav>
      </header>
      <div className="ws-drawer__body" ref={bodyRef}>
        {open ? children : null}
      </div>
    </aside>
  );
}
