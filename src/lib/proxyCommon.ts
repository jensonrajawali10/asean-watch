// Helpers shared by the same-origin relays (api/ptwc.ts, api/dsda.ts, api/open-meteo.ts). Server side
// only: bundled into api/_lib/*-core.js by scripts/build-api.mjs. No secrets are involved.

/** Same-site only: Sec-Fetch-Site (when sent) must be same-origin/none; Origin (when sent) must match Host. */
export function sameSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(',')[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra },
  });
}

export function clientIpFrom(headers: Headers, fallback = 'unknown'): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || fallback;
  return headers.get('x-real-ip')?.trim() || fallback;
}

/**
 * A per-IP sliding-window limiter. check(ip, now) returns 0 when the request may go ahead, else the
 * seconds until it may. Bounded memory: the table is dropped when it holds more than 5000 IPs.
 */
export function makeRateLimiter(max: number, windowMs: number): { check(ip: string, now: number): number; reset(): void } {
  const hits = new Map<string, number[]>();
  return {
    check(ip, now) {
      const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(ip, recent);
        return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      }
      recent.push(now);
      hits.set(ip, recent);
      if (hits.size > 5000) hits.clear();
      return 0;
    },
    reset() {
      hits.clear();
    },
  };
}

/** ISO 8601 UTC without milliseconds. */
export function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
