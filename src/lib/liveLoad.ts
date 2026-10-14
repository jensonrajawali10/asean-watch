// Shared live -> cache -> backoff -> snapshot loader for the connector modules (quakesLive, seaLevel,
// ptwc, floodModel). Same behaviour as src/lib/warnings.ts: per-source timeout, a short session cache,
// a backoff after a 429 / network error / timeout, then the bundled real snapshot (HISTORICAL), and
// finally "unavailable". It never throws, and absence is never reported as "none".
import type { ConnectorStatus } from '../types';

export type Getter = (url: string, kind: 'json' | 'text') => Promise<unknown>;

export interface LiveLoadSpec<T> {
  /** Stable cache / backoff key, e.g. "usgs-quakes". */
  sourceId: string;
  /** Human name used in status text, e.g. "USGS earthquakes". */
  sourceName: string;
  /** Fetch and parse live data (throw on any failure or unusable payload). */
  live: (get: Getter) => Promise<T>;
  /** The bundled real snapshot parsed as HISTORICAL, or null when there is none. */
  snapshot: () => { value: T; retrievedAt: string } | null;
  /** Time the live value was fetched, for the status line. */
  retrievedAtOf: (value: T) => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  backoffMs?: number;
}

export interface LiveLoadResult<T> {
  value: T | null;
  status: ConnectorStatus;
}

export const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_BACKOFF_MS = 60 * 1000;
const CACHE_PREFIX = 'asean-watch:connector:v1:';
const BACKOFF_PREFIX = 'asean-watch:connector-backoff:v1:';

interface CacheEntry {
  storedAt: number;
  value: unknown;
}

const memoryCache = new Map<string, CacheEntry>();
const memoryBackoff = new Map<string, { until: number; reason: string }>();
const inflight = new Map<string, Promise<LiveLoadResult<unknown>>>();

function storage(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

export class HttpFailure extends Error {
  status: number;
  constructor(status: number) {
    super(status === 429 ? 'rate limited' : `HTTP ${status}`);
    this.status = status;
  }
}

function readCache(id: string, now: number, ttl: number): unknown {
  const fresh = (e: CacheEntry | null | undefined) => (e && now - e.storedAt >= 0 && now - e.storedAt < ttl ? e : null);
  const mem = fresh(memoryCache.get(id));
  if (mem) return mem.value;
  try {
    const raw = storage()?.getItem(CACHE_PREFIX + id);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.storedAt !== 'number' || !fresh(parsed)) return undefined;
    memoryCache.set(id, parsed);
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache(id: string, value: unknown, now: number): void {
  const entry = { storedAt: now, value };
  memoryCache.set(id, entry);
  try {
    storage()?.setItem(CACHE_PREFIX + id, JSON.stringify(entry));
  } catch {
    // storage full or unavailable: memory cache still works
  }
}

function readBackoff(id: string, now: number, backoffMs: number): { until: number; reason: string } | null {
  const ok = (b: { until: number; reason: string } | null | undefined) =>
    b && b.until > now && b.until - now <= backoffMs ? b : null;
  const mem = ok(memoryBackoff.get(id));
  if (mem) return mem;
  try {
    const raw = storage()?.getItem(BACKOFF_PREFIX + id);
    const parsed = raw ? (JSON.parse(raw) as { until: number; reason: string }) : null;
    const got = parsed && typeof parsed.until === 'number' && typeof parsed.reason === 'string' ? ok(parsed) : null;
    if (got) memoryBackoff.set(id, got);
    return got;
  } catch {
    return null;
  }
}

function writeBackoff(id: string, reason: string, until: number): void {
  memoryBackoff.set(id, { until, reason });
  try {
    storage()?.setItem(BACKOFF_PREFIX + id, JSON.stringify({ until, reason }));
  } catch {
    // ignore
  }
}

function clearBackoff(id: string): void {
  memoryBackoff.delete(id);
  try {
    storage()?.removeItem(BACKOFF_PREFIX + id);
  } catch {
    // ignore
  }
}

/** Clear every connector cache, backoff and in-flight load (tests, manual refresh). */
export function resetConnectorCaches(): void {
  memoryCache.clear();
  memoryBackoff.clear();
  inflight.clear();
  try {
    const s = storage();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith(BACKOFF_PREFIX))) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    // ignore
  }
}

function classify(err: unknown, timeoutMs: number): { reason: string; transient: boolean } {
  if (err instanceof HttpFailure) return { reason: err.message, transient: err.status === 429 || err.status >= 500 };
  if (err instanceof Error && err.name === 'AbortError') return { reason: `timed out after ${timeoutMs} ms`, transient: true };
  if (err instanceof TypeError) return { reason: 'network error, blocked or offline', transient: true };
  if (err instanceof Error) return { reason: err.message, transient: false };
  return { reason: String(err), transient: false };
}

function hhmm(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

export function isoNoMs(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fromSnapshot<T>(spec: LiveLoadSpec<T>, reason: string | null): LiveLoadResult<T> {
  let snap: { value: T; retrievedAt: string } | null = null;
  try {
    snap = spec.snapshot();
  } catch {
    snap = null;
  }
  if (snap) {
    return {
      value: snap.value,
      status: {
        sourceId: spec.sourceId,
        sourceName: spec.sourceName,
        status: 'snapshot',
        retrievedAt: snap.retrievedAt,
        message:
          (reason === null
            ? `HISTORICAL snapshot captured ${snap.retrievedAt}; not refreshed live. `
            : `Live source unavailable (${reason}); showing the HISTORICAL snapshot captured ${snap.retrievedAt}. `) +
          `Check ${spec.sourceName} directly for current data.`,
      },
    };
  }
  return {
    value: null,
    status: {
      sourceId: spec.sourceId,
      sourceName: spec.sourceName,
      status: 'unavailable',
      retrievedAt: null,
      message: `${spec.sourceName} unavailable${reason ? ` (${reason})` : ''}: check ${spec.sourceName} directly. Absence of data is not an all-clear.`,
    },
  };
}

/** The bundled snapshot only (no network), for offline-first rendering. */
export function snapshotOnly<T>(spec: LiveLoadSpec<T>): LiveLoadResult<T> {
  return fromSnapshot(spec, null);
}

async function run<T>(spec: LiveLoadSpec<T>): Promise<LiveLoadResult<T>> {
  const timeoutMs = spec.timeoutMs ?? 8000;
  const ttl = spec.ttlMs ?? DEFAULT_TTL_MS;
  const backoffMs = spec.backoffMs ?? DEFAULT_BACKOFF_MS;
  const now = Date.now();
  const cached = readCache(spec.sourceId, now, ttl) as T | undefined;
  if (cached !== undefined) {
    const at = spec.retrievedAtOf(cached);
    return {
      value: cached,
      status: { sourceId: spec.sourceId, sourceName: spec.sourceName, status: 'cached', retrievedAt: at, message: `Fetched live at ${at} (cached for ${Math.round(ttl / 60000)} min).` },
    };
  }
  const backoff = readBackoff(spec.sourceId, now, backoffMs);
  if (backoff) return fromSnapshot(spec, `${backoff.reason}; retrying live after ${hhmm(backoff.until)}`);
  const fetchImpl = spec.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (!fetchImpl) return fromSnapshot(spec, 'fetch is not available here');

  const controller = new AbortController();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  aborted.catch(() => undefined);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const get: Getter = (url, kind) =>
    Promise.race([
      (async () => {
        const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: kind === 'json' ? 'application/json' : '*/*' } });
        if (!res.ok) throw new HttpFailure(res.status);
        return kind === 'json' ? ((await res.json()) as unknown) : await res.text();
      })(),
      aborted,
    ]);
  try {
    const value = await spec.live(get);
    writeCache(spec.sourceId, value, Date.now());
    clearBackoff(spec.sourceId);
    const at = spec.retrievedAtOf(value);
    return { value, status: { sourceId: spec.sourceId, sourceName: spec.sourceName, status: 'live', retrievedAt: at, message: `LIVE, fetched ${at}.` } };
  } catch (err) {
    const { reason, transient } = classify(err, timeoutMs);
    let text = reason;
    if (transient) {
      const until = Date.now() + backoffMs;
      writeBackoff(spec.sourceId, reason, until);
      text = `${reason}; retrying live after ${hhmm(until)}`;
    }
    return fromSnapshot(spec, text);
  } finally {
    clearTimeout(timer);
  }
}

/** Live first, then cache, backoff, bundled snapshot, unavailable. Never throws; concurrent calls share one load. */
export async function loadLiveFirst<T>(spec: LiveLoadSpec<T>): Promise<LiveLoadResult<T>> {
  const existing = inflight.get(spec.sourceId) as Promise<LiveLoadResult<T>> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      return await run(spec);
    } catch (err) {
      return fromSnapshot(spec, err instanceof Error ? err.message : String(err));
    }
  })();
  inflight.set(spec.sourceId, p as Promise<LiveLoadResult<unknown>>);
  try {
    return await p;
  } finally {
    inflight.delete(spec.sourceId);
  }
}

// Small parsing helpers shared by the connector modules.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Longitude normalised to [-180, 180). */
export function normLon(lon: number): number {
  if (lon >= -180 && lon < 180) return lon;
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(l, -0) ? 0 : l;
}

/** Any ISO-ish timestamp with an offset (or "YYYY-MM-DD HH:MM:SS" taken as UTC) -> ISO 8601 UTC "Z", or null. */
export function toIsoUtc(value: unknown, assumeUtc = false): string | null {
  const s = str(value);
  if (!s) return null;
  let t = s.replace(' ', 'T');
  if (assumeUtc && !/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) t += 'Z';
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? isoNoMs(ms) : null;
}
