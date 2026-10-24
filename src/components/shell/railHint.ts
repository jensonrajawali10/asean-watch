// The first-visit callout beside the desktop rail (Taskbar.tsx): its text and whether it shows. Kept out of
// the component file so the component module exports components only (fast refresh).
import type { SectionId } from './workspace';

/** localStorage key: set once the first-visit rail callout has been dismissed or a section opened. */
export const RAIL_HINT_STORAGE_KEY = 'aw-rail-hint';
export const RAIL_HINT_TITLE = 'These buttons open the full data';
export const RAIL_HINT_TEXT = 'City tables, fire counts, every official alert word for word, sources, and a report you can download.';

export function railHintSeen(): boolean {
  try {
    return localStorage.getItem(RAIL_HINT_STORAGE_KEY) === 'seen';
  } catch {
    return false; // storage blocked: show it, it is one click to dismiss
  }
}

export function markRailHintSeen(): void {
  try {
    localStorage.setItem(RAIL_HINT_STORAGE_KEY, 'seen');
  } catch {
    // storage blocked: it stays hidden for this page view
  }
}

/** The callout shows on a first visit only while the map is in front (no section open yet). */
export function railHintShown(seen: boolean, active: SectionId | null): boolean {
  return !seen && active === null;
}
