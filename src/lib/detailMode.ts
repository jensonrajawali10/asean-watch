// Simple view (the default, for first-time visitors) or the full detail view. <html data-detail> drives the
// CSS that hides the advanced parts; useDetailMode lets components that draw outside the DOM (deck.gl layers)
// follow the same switch. The choice is kept in localStorage; blocked storage means simple.
import { useEffect, useState } from 'react';

export type DetailMode = 'simple' | 'full';
export const DETAIL_STORAGE_KEY = 'aw-detail';
const EVENT = 'aw:detailchange';

export function readDetail(): DetailMode {
  try {
    return globalThis.localStorage?.getItem(DETAIL_STORAGE_KEY) === 'full' ? 'full' : 'simple';
  } catch {
    return 'simple';
  }
}

export function applyDetail(mode: DetailMode): void {
  document.documentElement.dataset.detail = mode;
  try {
    localStorage.setItem(DETAIL_STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent<DetailMode>(EVENT, { detail: mode }));
}

export function useDetailMode(): DetailMode {
  const [mode, setMode] = useState<DetailMode>(readDetail);
  useEffect(() => {
    const on = (e: Event) => setMode((e as CustomEvent<DetailMode>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return mode;
}
