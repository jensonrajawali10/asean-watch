import { describe, expect, it } from 'vitest';
import { DETAIL_STORAGE_KEY, readDetail } from './detailMode';

describe('detail mode', () => {
  it('defaults to the simple view, and reads a saved full view', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
    try {
      expect(readDetail()).toBe('simple');
      store.set(DETAIL_STORAGE_KEY, 'full');
      expect(readDetail()).toBe('full');
      store.set(DETAIL_STORAGE_KEY, 'junk');
      expect(readDetail()).toBe('simple');
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
