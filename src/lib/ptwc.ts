// Pacific Tsunami Warning Center (PTWC) latest product, relayed verbatim as an OfficialWarning.
// tsunami.gov has no CORS, so the browser calls the same-origin strict proxy /api/ptwc (api/ptwc.ts,
// logic in src/lib/ptwcProxy.ts), which returns the fixed Atom feed and the CAP document it links.
// Live -> 5 min cache -> 60 s backoff -> bundled HISTORICAL snapshot (data/ptwc-snapshot.json,
// npm run refresh:ptwc) -> unavailable. Never throws. `vite dev` mounts the same handler at /api/ptwc
// (vite.config.ts), so localhost reads the live feed too.
//
// The Atom feed holds ONLY the latest product, which may concern any basin PTWC serves (Pacific,
// Hawaii, Caribbean/Atlantic). PTWC Pacific messages are issued for national authorities; the public
// warning for a country comes from its national agency.
import snapshotJson from '../../data/ptwc-snapshot.json';
import type { OfficialWarning, WarningFeedStatus } from '../types';
import { isoNoMs, isRecord, loadLiveFirst, num, snapshotOnly, str, toIsoUtc } from './liveLoad';
import { xmlBlocks, xmlText } from './warnings';

export const PTWC_ISSUER = 'Pacific Tsunami Warning Center (PTWC)';
export const PTWC_ISSUER_URL = 'https://www.tsunami.gov/';
export const PTWC_PROXY_PATH = '/api/ptwc';
export const PTWC_ATOM_URL = 'https://www.tsunami.gov/events/xml/PHEBAtom.xml';

export const PTWC_NATIONAL_AUTHORITIES_NOTE =
  'PTWC Pacific messages are for national authorities. The public warning for your country comes from your ' +
  'national agency (BMKG in Indonesia, PHIVOLCS in the Philippines, JMA in Japan, TMD in Thailand, MetMalaysia).';
export const PTWC_LATEST_ONLY_NOTE =
  'The PTWC feed holds only its latest product, so an earlier message may have been superseded.';
export const PTWC_ATTRIBUTION = 'Tsunami messages: NOAA/NWS Pacific Tsunami Warning Center (public U.S. Government information).';

export interface PtwcPayload {
  atomUrl: string;
  atom: string;
  capUrl: string | null;
  cap: string | null;
  retrievedAt: string;
}

export interface PtwcParsed {
  warnings: OfficialWarning[];
  /** Plain-text bulletin link from the feed, when given. */
  bulletinUrl: string | null;
  note: string;
}

function collapse(s: string | null): string | null {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

/** "lat,lon radius" (CAP circle) or "lat,lon depth" -> point. */
function latLon(text: string | null): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text ?? '');
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
}

/** Parse the proxy payload (Atom + CAP) into one OfficialWarning. Throws if neither document is usable. */
export function parsePtwc(payload: unknown, meta: { dataMode: 'live' | 'historical'; retrievedAt: string }): PtwcParsed {
  if (!isRecord(payload) || typeof payload.atom !== 'string') throw new Error('not a PTWC proxy payload');
  const atom = payload.atom;
  if (!/<feed[\s>]/i.test(atom)) throw new Error('not an Atom feed');
  const cap = typeof payload.cap === 'string' && /<alert[\s>]/i.test(payload.cap) ? payload.cap : null;
  const capUrl = cap ? str(payload.capUrl) : null;
  const feedHead = atom.split(/<entry[\s>]/i)[0];
  const feedTitle = collapse(xmlText(feedHead, 'title'));
  // The feed holds only the latest product, so its own <updated> is that product's time. Used when the
  // feed carries no entry and no CAP link (as on 24 Oct 2026: a title and an Energy Map link only).
  const feedUpdated = toIsoUtc(xmlText(feedHead, 'updated'));
  const entry = xmlBlocks(atom, 'entry')[0] ?? null;
  const entryTitle = entry ? collapse(xmlText(entry, 'title')) : null;
  const entryUpdated = entry ? toIsoUtc(xmlText(entry, 'updated')) : null;
  const summary = entry ? (xmlText(entry, 'summary') ?? '') : '';
  const category = collapse(/Category:\s*<\/strong>\s*([^<]+)/i.exec(summary)?.[1] ?? null);
  const bulletinTag = (entry ?? '').match(/<link\b[^>]*title=["']Bulletin["'][^>]*>/i)?.[0] ?? null;
  const bulletinUrl = bulletinTag ? attr(bulletinTag, 'href') : null;
  const entryPoint = entry
    ? (() => {
        const lat = num(xmlText(entry, 'geo:lat'));
        const lon = num(xmlText(entry, 'geo:long'));
        return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
      })()
    : null;

  const info = cap ? (xmlBlocks(cap, 'info')[0] ?? null) : null;
  const identifier = cap ? collapse(xmlText(cap, 'identifier')) : null;
  const msgType = cap ? collapse(xmlText(cap, 'msgType')) : null;
  const event = info ? collapse(xmlText(info, 'event')) : null;
  const headline = info ? collapse(xmlText(info, 'headline')) : null;
  const instructionRaw = info ? collapse(xmlText(info, 'instruction')) : null;
  const area = info ? (xmlBlocks(info, 'area')[0] ?? null) : null;
  const areaDesc = area ? collapse(xmlText(area, 'areaDesc')) : null;
  const circle = area ? latLon(xmlText(area, 'circle')) : null;
  const sent = cap ? toIsoUtc(xmlText(cap, 'sent')) : null;
  const expires = info ? toIsoUtc(xmlText(info, 'expires')) : null;

  if (!event && !category && !feedTitle) throw new Error('no PTWC product found');
  const issuedAt = sent ?? entryUpdated ?? feedUpdated;
  const ended =
    msgType === 'Cancel' || (expires !== null && Date.parse(expires) <= Date.parse(meta.retrievedAt));
  const location = circle ?? entryPoint;
  const warning: OfficialWarning = {
    id: `ptwc:${identifier ?? issuedAt ?? 'latest'}`,
    issuer: PTWC_ISSUER,
    issuerUrl: PTWC_ISSUER_URL,
    authority: 'official',
    hazard: 'tsunami',
    // Verbatim: the feed's product title, e.g. "TSUNAMI INFORMATION STATEMENT NUMBER 1".
    product: feedTitle ?? event ?? 'PTWC product',
    // Verbatim: the CAP event, e.g. "Tsunami Information"; else the Atom "Category".
    level: event ?? category ?? feedTitle ?? 'PTWC product',
    levelGloss: null,
    headline: headline ?? feedTitle ?? event ?? 'PTWC product',
    areaDescription: areaDesc ?? entryTitle ?? '',
    areas: areaDesc || entryTitle ? [{ name: (areaDesc ?? entryTitle) as string, level: null, lat: location?.lat ?? null, lon: location?.lon ?? null }] : [],
    location,
    issuedAt,
    expiresAt: expires,
    ended,
    instruction: instructionRaw && !/^N\/?A$/i.test(instructionRaw) ? instructionRaw : null,
    language: 'en',
    sourceUrl: capUrl ?? (str(payload.atomUrl) ?? PTWC_ATOM_URL),
    dataMode: meta.dataMode,
    retrievedAt: meta.retrievedAt,
  };
  return { warnings: [warning], bulletinUrl, note: `${PTWC_NATIONAL_AUTHORITIES_NOTE} ${PTWC_LATEST_ONLY_NOTE}` };
}

export const BUNDLED_PTWC_SNAPSHOT = snapshotJson as unknown as PtwcPayload;

export interface PtwcResult extends PtwcParsed {
  status: WarningFeedStatus;
  attribution: string;
}

function toFeedStatus(s: { status: WarningFeedStatus['status']; retrievedAt: string | null; message: string }): WarningFeedStatus {
  const message =
    s.status === 'unavailable' ? `Official feed unavailable: check ${PTWC_ISSUER} directly` : s.message;
  return { feedId: 'ptwc', issuer: PTWC_ISSUER, issuerUrl: PTWC_ISSUER_URL, status: s.status, retrievedAt: s.retrievedAt, message };
}

/**
 * Client timeout for /api/ptwc. Above the proxy's whole upstream budget (PTWC_UPSTREAM_BUDGET_MS, 7 s)
 * plus a serverless cold start, so a slow tsunami.gov during a real event is waited for rather than
 * replaced by the HISTORICAL snapshot and a 60 s backoff.
 */
export const PTWC_CLIENT_TIMEOUT_MS = 15000;

function spec(source: PtwcPayload | null, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; proxyUrl?: string }) {
  return {
    sourceId: 'ptwc',
    sourceName: PTWC_ISSUER,
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? PTWC_CLIENT_TIMEOUT_MS,
    retrievedAtOf: (v: PtwcParsed) => v.warnings[0]?.retrievedAt ?? isoNoMs(Date.now()),
    live: async (get: (url: string, kind: 'json' | 'text') => Promise<unknown>) => {
      const payload = await get(opts?.proxyUrl ?? PTWC_PROXY_PATH, 'json');
      const retrievedAt = isRecord(payload) ? (toIsoUtc(payload.retrievedAt) ?? isoNoMs(Date.now())) : isoNoMs(Date.now());
      return parsePtwc(payload, { dataMode: 'live', retrievedAt });
    },
    snapshot: () => {
      if (!source || typeof source.retrievedAt !== 'string') return null;
      return { value: parsePtwc(source, { dataMode: 'historical', retrievedAt: source.retrievedAt }), retrievedAt: source.retrievedAt };
    },
  };
}

const EMPTY: PtwcParsed = { warnings: [], bulletinUrl: null, note: `${PTWC_NATIONAL_AUTHORITIES_NOTE} ${PTWC_LATEST_ONLY_NOTE}` };

/** Latest PTWC product via /api/ptwc, with the HISTORICAL snapshot fallback. Never throws. */
export async function loadPtwc(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  proxyUrl?: string;
  snapshot?: PtwcPayload | null;
}): Promise<PtwcResult> {
  const source = opts?.snapshot === undefined ? BUNDLED_PTWC_SNAPSHOT : opts.snapshot;
  const r = await loadLiveFirst(spec(source, opts));
  return { ...(r.value ?? EMPTY), status: toFeedStatus(r.status), attribution: PTWC_ATTRIBUTION };
}

export function loadPtwcSnapshot(source: PtwcPayload | null = BUNDLED_PTWC_SNAPSHOT): PtwcResult {
  const r = snapshotOnly(spec(source));
  return { ...(r.value ?? EMPTY), status: toFeedStatus(r.status), attribution: PTWC_ATTRIBUTION };
}
