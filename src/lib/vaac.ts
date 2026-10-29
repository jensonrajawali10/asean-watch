// Volcanic Ash Advisories (VAA) from the Tokyo VAAC (Japan Meteorological Agency), relayed word for word as
// OfficialWarnings. The browser calls the same-origin cached relay /api/vaac (src/lib/vaacProxy.ts), which
// builds the newest advisory per volcano issued in the last 24 hours (scripts/lib/vaacBuild.mjs).
// Live -> 5 min cache -> 60 s backoff -> bundled HISTORICAL snapshot (data/vaac-snapshot.json,
// npm run refresh:vaac) -> unavailable. Never throws. `vite dev` mounts the same relay at /api/vaac.
//
// A VAA is an aviation product (ICAO): it tells pilots and airlines where volcanic ash is or is forecast in
// the air. It is not a public warning, gives no instruction to people on the ground, and is never read as a
// volcano's alert level (hazard 'ash', not 'volcano'). The text is shown as issued; the fields below are read
// from it by their ICAO labels only to place, date and group it.
//
// Coverage: Tokyo VAAC covers Japan, the northern Philippines (Mayon, Taal, Kanlaon), the Kuril Islands and
// Kamchatka. Indonesia is VAAC Darwin's (Bureau of Meteorology), which is linked, not relayed: see
// src/lib/volcanoOfficial.ts.
//
// The 24-hour window is applied again against the visitor's clock, to the relay's answer and to the bundled
// snapshot, so an old copy never looks current. An empty list is never an all-clear.
import snapshotJson from '../../data/vaac-snapshot.json';
import type { OfficialWarning, WarningFeedStatus } from '../types';
import { isoNoMs, isRecord, loadLiveFirst, snapshotOnly, str, toIsoUtc } from './liveLoad';
import { VAAC_RELAY_PATH } from './vaacRelay';
import type { VaacBuildData } from './vaacRelay';

export const VAAC_TOKYO_FEED_ID = 'vaac-tokyo';
export const VAAC_TOKYO_ISSUER = 'Tokyo VAAC (Japan Meteorological Agency)';
export const VAAC_TOKYO_ISSUER_URL = 'https://www.data.jma.go.jp/vaac/data/vaac_list.html';
/** Advisories issued within this many hours of the visitor's clock are shown (as the relay keeps). */
export const VAAC_WINDOW_HOURS = 24;

/** Fixed, reviewed gloss for the verbatim "VA ADVISORY" product line. */
export const VAA_LEVEL_GLOSS = 'Volcanic ash advisory for aviation, not a public warning';
export const VAA_AVIATION_NOTE =
  'A Volcanic Ash Advisory is an aviation product: it tells pilots and airlines where volcanic ash is, or is forecast, in the air. ' +
  'It is not a public warning and gives no instruction to people on the ground; follow the national volcano agency for that.';
export const VAAC_WINDOW_NOTE =
  'Only the newest advisory per volcano issued in the last 24 hours is shown; earlier ones in a series are superseded. ' +
  'None shown is not an all-clear: check the Tokyo VAAC list.';
export const VAAC_TOKYO_ATTRIBUTION =
  'Volcanic ash advisories: Tokyo VAAC, Japan Meteorological Agency (source: JMA website, https://www.data.jma.go.jp/vaac/data/vaac_list.html; ' +
  'Public Data License v1.0, compatible with CC BY 4.0).';

const HOUR_MS = 3_600_000;
/** The ICAO labels of a VA advisory; a line starting with none of them continues the field above. */
const LABEL =
  /^(DTG|VAAC|VOLCANO|PSN|AREA|SUMMIT ELEV|SOURCE ELEV|ADVISORY NR|INFO SOURCE|AVIATION COLOU?R CODE|ERUPTION DETAILS|OBS VA DTG|EST VA DTG|OBS VA CLD|EST VA CLD|FCST VA CLD \+\s?\d+\s?HR|RMK|NXT ADVISORY):\s?(.*)$/;

/** The advisory's fields by ICAO label, values word for word (continuation lines joined with a newline). */
export function vaaFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let last: string | null = null;
  for (const line of text.split('\n')) {
    const m = LABEL.exec(line);
    if (m) {
      last = m[1];
      out[last] = m[2].trim();
    } else if (last && line.trim() !== '') {
      out[last] = `${out[last]}\n${line.trim()}`;
    }
  }
  return out;
}

/** "20261029/1145Z" -> "2026-10-29T11:45:00Z"; null when it does not read. */
export function vaaDtg(value: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})\/(\d{2})(\d{2})Z$/.exec(value?.trim() ?? '');
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const d = new Date(ms);
  return Number.isFinite(ms) && d.getUTCDate() === +m[3] && d.getUTCHours() === +m[4] ? isoNoMs(ms) : null;
}

/** "N3136 E13039" (degrees and minutes) -> { lat: 31.6, lon: 130.65 }; null for "UNKNOWN" or anything else. */
export function vaaPosition(value: string | undefined): { lat: number; lon: number } | null {
  const m = /^([NS])(\d{2})(\d{2})\s+([EW])(\d{3})(\d{2})$/.exec(value?.trim() ?? '');
  if (!m || +m[3] >= 60 || +m[6] >= 60) return null;
  const lat = (+m[2] + +m[3] / 60) * (m[1] === 'S' ? -1 : 1);
  const lon = (+m[5] + +m[6] / 60) * (m[4] === 'W' ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/** "SAKURAJIMA (AIRA CALDERA) 282080" -> name and Smithsonian GVP number (null when none is given). */
export function vaaVolcano(value: string | undefined): { name: string; gvp: string | null } {
  const v = value?.trim() ?? '';
  const m = /^(.*\S)\s+(\d{6})$/.exec(v);
  return m ? { name: m[1], gvp: m[2] } : { name: v, gvp: null };
}

/**
 * One advisory text -> an OfficialWarning, or null when it is not a Tokyo VA advisory with a readable time
 * (another VAAC's text is never relayed under JMA's licence).
 */
export function vaaToWarning(
  a: { text: string; url: string },
  meta: { dataMode: 'live' | 'historical'; retrievedAt: string },
): OfficialWarning | null {
  const text = a.text.trim();
  if (!/^VA ADVISORY$/m.test(text)) return null;
  const f = vaaFields(text);
  if (f.VAAC?.trim() !== 'TOKYO') return null;
  const issuedAt = vaaDtg(f.DTG);
  if (!issuedAt) return null;
  const volcano = vaaVolcano(f.VOLCANO);
  const location = vaaPosition(f.PSN);
  const compactDtg = f.DTG.trim().replace('/', 'T');
  return {
    id: `${VAAC_TOKYO_FEED_ID}:${volcano.gvp ? `${volcano.gvp}:` : ''}${compactDtg}`,
    issuer: VAAC_TOKYO_ISSUER,
    issuerUrl: VAAC_TOKYO_ISSUER_URL,
    authority: 'official',
    hazard: 'ash',
    product: 'VA ADVISORY',
    level: 'VA ADVISORY',
    levelGloss: VAA_LEVEL_GLOSS,
    headline: f.VOLCANO ? `VOLCANO: ${f.VOLCANO}` : 'VA ADVISORY',
    areaDescription: f.AREA ?? '',
    areas: volcano.name ? [{ name: volcano.name, level: null, lat: location?.lat ?? null, lon: location?.lon ?? null }] : [],
    location,
    issuedAt,
    expiresAt: null,
    // The issuer's own words close a series; nothing else ends an advisory here.
    ended: /NO FURTHER ADVISORIES/i.test(f['NXT ADVISORY'] ?? ''),
    instruction: null,
    text,
    language: 'en',
    sourceUrl: a.url,
    dataMode: meta.dataMode,
    retrievedAt: meta.retrievedAt,
  };
}

export interface VaacParsed {
  warnings: OfficialWarning[];
  retrievedAt: string;
}

/**
 * The relay build (or the snapshot) -> the newest advisory per volcano issued within VAAC_WINDOW_HOURS of
 * `nowMs`, newest first. Throws if the build is not a VAAC build at all.
 */
export function parseVaac(build: unknown, meta: { dataMode: 'live' | 'historical'; retrievedAt: string; nowMs: number }): VaacParsed {
  if (!isRecord(build) || !Array.isArray(build.advisories)) throw new Error('not a VAAC build');
  const from = meta.nowMs - VAAC_WINDOW_HOURS * HOUR_MS;
  const newest = new Map<string, OfficialWarning>();
  for (const a of build.advisories) {
    if (!isRecord(a) || typeof a.text !== 'string') continue;
    const url = str(a.url);
    if (!url || !url.startsWith('https://www.data.jma.go.jp/vaac/')) continue;
    const w = vaaToWarning({ text: a.text, url }, meta);
    if (!w?.issuedAt) continue;
    const t = Date.parse(w.issuedAt);
    if (!(t > from && t <= meta.nowMs + 10 * 60_000)) continue;
    const key = w.areas[0]?.name ? `${w.areas[0].name}|${w.areaDescription}` : w.id;
    const held = newest.get(key);
    if (!held || Date.parse(held.issuedAt ?? '') < t) newest.set(key, w);
  }
  const warnings = [...newest.values()].sort((x, y) => (y.issuedAt ?? '').localeCompare(x.issuedAt ?? '') || x.id.localeCompare(y.id));
  return { warnings, retrievedAt: meta.retrievedAt };
}

export const BUNDLED_VAAC_SNAPSHOT = snapshotJson as unknown as VaacBuildData;

export interface VaacResult extends VaacParsed {
  status: WarningFeedStatus;
  /** The aviation and 24-hour notes, for the feed status line. */
  note: string;
  attribution: string;
}

class RelayUnavailable extends Error {}

function toFeedStatus(s: { status: WarningFeedStatus['status']; retrievedAt: string | null; message: string }): WarningFeedStatus {
  const message = s.status === 'unavailable' ? `Official feed unavailable: check ${VAAC_TOKYO_ISSUER} directly` : s.message;
  return { feedId: VAAC_TOKYO_FEED_ID, issuer: VAAC_TOKYO_ISSUER, issuerUrl: VAAC_TOKYO_ISSUER_URL, status: s.status, retrievedAt: s.retrievedAt, message };
}

/** Client timeout for /api/vaac: above the relay's 20 s upstream budget plus a cold start. */
export const VAAC_CLIENT_TIMEOUT_MS = 25000;

function spec(source: VaacBuildData | null, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; proxyUrl?: string; nowMs?: number }) {
  const nowMs = () => opts?.nowMs ?? Date.now();
  return {
    sourceId: VAAC_TOKYO_FEED_ID,
    sourceName: VAAC_TOKYO_ISSUER,
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? VAAC_CLIENT_TIMEOUT_MS,
    retrievedAtOf: (v: VaacParsed) => v.retrievedAt,
    live: async (get: (url: string, kind: 'json' | 'text') => Promise<unknown>) => {
      const payload = await get(opts?.proxyUrl ?? VAAC_RELAY_PATH, 'json');
      if (!isRecord(payload) || payload.available !== true) {
        throw new RelayUnavailable(isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'relay unavailable');
      }
      const data = payload.data;
      const retrievedAt = (isRecord(data) && toIsoUtc(data.retrievedAt)) || isoNoMs(Date.now());
      return parseVaac(data, { dataMode: 'live', retrievedAt, nowMs: nowMs() });
    },
    snapshot: () => {
      if (!source || typeof source.retrievedAt !== 'string') return null;
      return { value: parseVaac(source, { dataMode: 'historical', retrievedAt: source.retrievedAt, nowMs: nowMs() }), retrievedAt: source.retrievedAt };
    },
  };
}

const NOTE = `${VAA_AVIATION_NOTE} ${VAAC_WINDOW_NOTE}`;

function result(r: { value: VaacParsed | null; status: { status: WarningFeedStatus['status']; retrievedAt: string | null; message: string } }): VaacResult {
  return {
    warnings: r.value?.warnings ?? [],
    retrievedAt: r.value?.retrievedAt ?? r.status.retrievedAt ?? '',
    status: toFeedStatus(r.status),
    note: NOTE,
    attribution: VAAC_TOKYO_ATTRIBUTION,
  };
}

/** Tokyo VAAC advisories via /api/vaac, with the HISTORICAL snapshot fallback. Never throws. */
export async function loadVaac(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  proxyUrl?: string;
  snapshot?: VaacBuildData | null;
  /** The visitor's clock for the 24-hour window (tests). */
  nowMs?: number;
}): Promise<VaacResult> {
  const source = opts?.snapshot === undefined ? BUNDLED_VAAC_SNAPSHOT : opts.snapshot;
  return result(await loadLiveFirst(spec(source, opts)));
}

export function loadVaacSnapshot(source: VaacBuildData | null = BUNDLED_VAAC_SNAPSHOT, nowMs?: number): VaacResult {
  return result(snapshotOnly(spec(source, { nowMs })));
}
