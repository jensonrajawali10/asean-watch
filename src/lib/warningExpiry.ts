// Whether a relayed message is still in force. Its own module (no imports) so that warnings.ts and
// tsunamiAreas.ts can both use it without an import cycle through warningsView.ts.
import type { OfficialWarning } from '../types';

/** Epoch ms of an ISO time, or null when absent or unreadable. */
export function timeMs(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * True when a message is no longer in force: the issuer ended or cancelled it, or its expiry has passed
 * on the nowMs clock. `ended` alone was fixed when the message was parsed (against its retrieval time),
 * so a bundled snapshot or a tab left open would otherwise keep an expired message active.
 */
export function isExpired(w: Pick<OfficialWarning, 'ended' | 'expiresAt'>, nowMs: number): boolean {
  if (w.ended) return true;
  const expires = timeMs(w.expiresAt);
  return expires !== null && expires <= nowMs;
}
