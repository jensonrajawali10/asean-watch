// Official warnings relay (evacuation awareness). Owned by the logic builder.
//
// ASEAN Watch RELAYS official warnings; it never issues its own. Every text field is copied verbatim
// from the issuer (only outer whitespace is trimmed). Levels are never re-scored, merged, translated
// or restyled. A `levelGloss` comes only from the fixed, reviewed tables in this file. Absence of a
// message is never an all-clear: a failed feed with no snapshot reports
// "Official feed unavailable: check <issuer> directly".
//
// Sources (all verified live on 2026-10-13 by scripts/capture-warnings-snapshot.mjs; research in
// docs/research/APIS_GEOPHYSICAL.md sections 2-4 and docs/research/APIS_HYDROMET.md):
// - BMKG InaTEWS last30tsunamievent.xml and datagempa.json (CORS *). Times are WIB (UTC+7).
// - JMA bosai tsunami list.json + latest detail, volcano warning.json + volcano_list.json (CORS *).
// - GeoNet /volcano/val (no timestamp), NWS /alerts/active (US Pacific territories), GDACS events API.
// - MAGMA Indonesia (PVMBG): API is token-only. The capture script parses the public level list
//   https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas (src/lib/magmaLevels.ts) into snapshot records,
//   with the capture time as retrievedAt (Level III/IV plus the watched volcanoes). Coordinates: Smithsonian GVP WFS.
// - ThaiWater waterlevel_load (HII; RID gauges). Times are ICT (UTC+7) with no offset.
// - Jakarta DSDA Posko Banjir xmldata.xml. Units: the XML is in millimetres. Evidence: DSDA's own page
//   https://poskobanjir.dsdadki.web.id/ renders every value as `value / 10 + " cm"` (thresholds and
//   water level, e.g. label_siaga1 " > " + vSiaga1 / 10 + " cm (BAHAYA)"), and Katulampa's 2000/1500/800
//   match its published 200/150/80 cm Siaga levels. We show cm, as DSDA does.
// - data.gov.sg PUB flood alerts (shares the NEA data.gov.sg rate-limit backoff).
import snapshotJson from '../../data/warnings-snapshot.json';
import type { OfficialWarning, OfficialWarningArea, TsunamiObservation, WarningFeedStatus, WarningHazard } from '../types';
import { dataGovSgBackoffUntil, haversineKm, markDataGovSgRateLimited, toUtcIso } from './nea';
import { idnDistrictIndex, placeTsunamiAreas } from './tsunamiAreas';
import { isExpired } from './warningExpiry';

// ---------------------------------------------------------------------------
// Public types

/** Normalised water-level gauge reading (for a later chart). Will move to types.ts. */
export interface GaugeReading {
  id: string;
  /** Verbatim gauge name. */
  name: string;
  issuer: string;
  lat: number;
  lon: number;
  /** ISO 8601 UTC. */
  observedAt: string;
  value: number;
  unit: string;
  /** Vertical datum of `value`, e.g. "MSL" or "gauge zero (DSDA)". */
  datum: string;
  /** Issuer's own situation or status text, verbatim; null when none. */
  situation: string | null;
  /** Issuer's numeric situation level (ThaiWater situation_level 1-5); absent or null when none. */
  situationLevel?: number | null;
  /** Our plain-English gloss of the level, from a fixed reviewed table (never the issuer's words); null when none. */
  situationGloss?: string | null;
  /** Issuer's thresholds in the same unit and datum as `value`. */
  thresholds?: Record<string, number> | null;
  sourceUrl: string;
  dataMode: 'live' | 'historical';
  retrievedAt: string;
}

export interface OfficialWarningsResult {
  warnings: OfficialWarning[];
  feeds: WarningFeedStatus[];
  gauges: GaugeReading[];
}

export interface FeedParseResult {
  warnings: OfficialWarning[];
  gauges: GaugeReading[];
  /** Feed-level status text (never all-clear wording). */
  note: string | null;
}

export interface ParseMeta {
  dataMode: 'live' | 'historical';
  /** ISO 8601 UTC. */
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Small helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function validLatLon(lat: number | null, lon: number | null): { lat: number; lon: number } | null {
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function nowIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Local wall-clock time at a fixed UTC offset -> ISO 8601 UTC, or null for an impossible time. */
export function localToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  offsetHours: number,
): string | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(local);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return nowIso(local - offsetHours * 3600000);
}

/**
 * BMKG WIB (UTC+7) times -> UTC. Accepts "15/08/2026 07:31:30WIB", "15-08-2026 05:02:23 WIB" and
 * "2026-08-15T07:31:30WIB".
 */
export function wibToUtc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  let m = /^(\d{2})[/-](\d{2})[/-](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*WIB$/i.exec(t);
  if (m) return localToUtc(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0, 7);
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*WIB$/i.exec(t);
  if (m) return localToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, 7);
  return null;
}

/** ThaiWater "2026-10-13 12:00" (ICT, UTC+7, no offset in the payload) -> UTC. */
export function ictToUtc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  return m ? localToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, 7) : null;
}

/** GDACS times carry no zone; GDACS publishes UTC (treated as UTC, per the research note). */
function gdacsToUtc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return toUtcIso(/(Z|[+-]\d{2}:\d{2})$/.test(t) ? t : `${t}Z`);
}

// --- A small tolerant extractor for BMKG's and DSDA's flat XML (no DOMParser in node tests) -------

function decodeXml(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1];
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent.startsWith('#')) {
      const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return named[ent.toLowerCase()] ?? whole;
  });
}

/** Inner XML of every complete <tag>...</tag> (truncated trailing blocks are ignored). */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** Decoded text of the first <tag>, outer whitespace trimmed; null when absent or empty. */
export function xmlText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return null;
  const t = decodeXml(m[1]).trim();
  return t === '' ? null : t;
}

// ---------------------------------------------------------------------------
// Fixed, reviewed level glosses (never machine translation)

/** JMA Volcanic Alert Levels: codes 11-15 are Levels 1-5. Keyword meanings apply only when JMA's own keyword is present. */
const JMA_VOLCANO_GLOSS: Record<string, { level: number; keyword: string; meaning: string }> = {
  '11': { level: 1, keyword: '活火山であることに留意', meaning: 'note that this is an active volcano' },
  '12': { level: 2, keyword: '火口周辺規制', meaning: 'crater area restricted' },
  '13': { level: 3, keyword: '入山規制', meaning: 'entry to the volcano restricted' },
  '14': { level: 4, keyword: '高齢者等避難', meaning: 'elderly and others evacuate' },
  '15': { level: 5, keyword: '避難', meaning: 'evacuate' },
};

export function jmaVolcanoGloss(code: string | null, name: string): string | null {
  const g = code ? JMA_VOLCANO_GLOSS[code] : undefined;
  if (!g) return null;
  const rank = `JMA Volcanic Alert Level ${g.level} of 5${g.level === 5 ? ' (highest)' : ''}`;
  // Code 15's keyword (避難) is a substring of code 14's; codes are checked first, so this is safe.
  return name.includes(g.keyword) ? `${rank}: ${g.meaning}` : rank;
}

/** ThaiWater situation levels (scale in waterlevel_load: >100, >70, >30, >10, <=10 % of bank capacity). */
const THAIWATER_GLOSS: Record<number, string> = {
  5: 'Overflowing bank (ThaiWater situation level 5 of 5: above 100% of bank capacity)',
  4: 'High water (ThaiWater situation level 4 of 5: above 70% of bank capacity)',
  3: 'Normal water (ThaiWater situation level 3 of 5: above 30% of bank capacity)',
  2: 'Low water (ThaiWater situation level 2 of 5: above 10% of bank capacity)',
  1: 'Critically low water (ThaiWater situation level 1 of 5: 10% of bank capacity or less)',
};

/**
 * Gauges at or above this ThaiWater situation level are relayed as flood warnings (4 = high, 5 = overflowing bank).
 * Lead decision 2026-10-13: relay overflowing bank only (level 4 gave ~185 items); every gauge stays in `gauges`.
 */
export const THAIWATER_RELAY_MIN_LEVEL = 5;

/** Jakarta DSDA Siaga: Siaga 1 is the MOST severe (DSDA's page labels it BAHAYA); Siaga 4 the least. */
const DSDA_GLOSS: Record<string, string> = {
  '1': 'Siaga 1 is the MOST severe of DSDA’s four levels (DSDA labels it BAHAYA); Siaga 4 is the least',
  '2': 'Siaga 2 is the second most severe of DSDA’s four levels (Siaga 1 is the most severe)',
  '3': 'Siaga 3 is the third of DSDA’s four levels (Siaga 1 is the most severe)',
  '4': 'Siaga 4 is the LEAST severe of DSDA’s four levels (Siaga 1 is the most severe)',
};

/** BMKG InaTEWS per-area levels, most severe first (AWAS > SIAGA > WASPADA). Used for ordering only. */
export const BMKG_LEVEL_RANK: Record<string, number> = { AWAS: 3, SIAGA: 2, WASPADA: 1 };

// ---------------------------------------------------------------------------
// Feed identities

export const FEEDS = {
  bmkgInatews: {
    id: 'bmkg-inatews',
    issuer: 'BMKG InaTEWS',
    issuerUrl: 'https://inatews.bmkg.go.id/',
    url: 'https://bmkg-content-inatews.storage.googleapis.com/last30tsunamievent.xml',
  },
  bmkgGempa: {
    id: 'bmkg-gempa',
    issuer: 'BMKG InaTEWS',
    issuerUrl: 'https://inatews.bmkg.go.id/',
    url: 'https://bmkg-content-inatews.storage.googleapis.com/datagempa.json',
  },
  jmaTsunami: {
    id: 'jma-tsunami',
    issuer: 'Japan Meteorological Agency',
    issuerUrl: 'https://www.jma.go.jp/bosai/map.html',
    url: 'https://www.jma.go.jp/bosai/tsunami/data/list.json',
  },
  jmaVolcano: {
    id: 'jma-volcano',
    issuer: 'Japan Meteorological Agency',
    issuerUrl: 'https://www.jma.go.jp/bosai/map.html',
    url: 'https://www.jma.go.jp/bosai/volcano/data/warning.json',
  },
  geonet: {
    id: 'geonet-val',
    issuer: 'GeoNet (GNS Science)',
    issuerUrl: 'https://www.geonet.org.nz/volcano',
    url: 'https://api.geonet.org.nz/volcano/val',
  },
  nws: {
    id: 'nws-tsunami',
    issuer: 'US National Weather Service',
    issuerUrl: 'https://www.weather.gov/',
    url: 'https://api.weather.gov/alerts/active?area=GU,MP,AS,HI&event=Tsunami%20Warning,Tsunami%20Advisory,Tsunami%20Watch',
  },
  gdacs: {
    id: 'gdacs',
    issuer: 'GDACS',
    issuerUrl: 'https://www.gdacs.org/',
    url: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH',
  },
  magma: {
    id: 'magma-level-list',
    issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
    issuerUrl: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
    url: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
  },
  thaiwater: {
    id: 'thaiwater',
    issuer: 'ThaiWater (Hydro-Informatics Institute)',
    issuerUrl: 'https://www.thaiwater.net/',
    url: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load',
  },
  dsda: {
    id: 'dsda-jakarta',
    issuer: 'Dinas Sumber Daya Air DKI Jakarta (Posko Banjir DSDA)',
    issuerUrl: 'https://poskobanjir.dsdadki.web.id/',
    url: 'https://poskobanjir.dsdadki.web.id/xmldata.xml',
  },
  pub: {
    id: 'pub-flood',
    issuer: 'PUB, Singapore’s National Water Agency (via data.gov.sg)',
    issuerUrl: 'https://www.pub.gov.sg/',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts',
  },
} as const;

type FeedKey = keyof typeof FEEDS;

function base(
  feed: (typeof FEEDS)[FeedKey],
  meta: ParseMeta,
  fields: Omit<OfficialWarning, 'issuer' | 'issuerUrl' | 'dataMode' | 'retrievedAt'>,
): OfficialWarning {
  return { ...fields, issuer: feed.issuer, issuerUrl: feed.issuerUrl, dataMode: meta.dataMode, retrievedAt: meta.retrievedAt };
}

function expired(expiresAt: string | null, retrievedAt: string): boolean {
  if (!expiresAt) return false;
  const e = Date.parse(expiresAt);
  const r = Date.parse(retrievedAt);
  return Number.isFinite(e) && Number.isFinite(r) && e <= r;
}

// ---------------------------------------------------------------------------
// Parsers (pure)

/** BMKG quake origin from <date>15-08-26</date><time>04:58:24 WIB</time> (two-digit year) -> epoch ms. */
/**
 * A BMKG quake's origin time from its <date>/<time> (or datagempa info.date/info.time) fields, e.g.
 * "15-08-26" + "04:58:24 WIB" -> ISO 8601 UTC. Null when either is missing or unreadable.
 */
export function bmkgOriginUtc(date: unknown, time: unknown): string | null {
  const d = /^(\d{2})-(\d{2})-(\d{2,4})$/.exec(typeof date === 'string' ? date.trim() : '');
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?\s*WIB$/i.exec(typeof time === 'string' ? time.trim() : '');
  if (!d || !t) return null;
  const year = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  return localToUtc(year, +d[2], +d[1], +t[1], +t[2], t[3] ? +t[3] : 0, 7);
}

function bmkgOriginMs(date: string | null, time: string | null): number | null {
  const iso = bmkgOriginUtc(date, time);
  return iso ? Date.parse(iso) : null;
}

/**
 * BMKG InaTEWS <obsarea> tide-gauge observations in one <info>: verbatim location and height (m), the
 * gauge's own coordinates, and the time (WIB -> UTC when a full date is given). Entries without a valid
 * position or a finite height are skipped (never guessed).
 */
export function bmkgObservations(infoBlock: string): TsunamiObservation[] {
  const out: TsunamiObservation[] = [];
  for (const o of xmlBlocks(infoBlock, 'obsarea')) {
    const location = xmlText(o, 'location');
    const pos = validLatLon(num(xmlText(o, 'loclatitude')), num(xmlText(o, 'loclongitude')));
    const heightText = xmlText(o, 'height');
    const heightM = num(heightText);
    if (!location || !pos || heightM === null || heightText === null) continue;
    const date = xmlText(o, 'date');
    const timeText = xmlText(o, 'time');
    const observedAt = date && timeText ? wibToUtc(`${date} ${timeText}`) : null;
    out.push({ location, lat: pos.lat, lon: pos.lon, heightM, heightText, observedAt, timeText });
  }
  return out;
}

/**
 * BMKG's own instruction for one tsunami warning level, verbatim from the message: the <instruction1..3>
 * line that names the level in quotes (e.g. status "Siaga"). Null when the message has no such line.
 * No gloss of our own: BMKG's words are shown as they are (Indonesian), with a link to BMKG.
 */
export function bmkgLevelInstruction(w: Pick<OfficialWarning, 'instruction'>, level: string | null | undefined): string | null {
  const want = level?.trim().toLowerCase();
  if (!want || !w.instruction) return null;
  for (const line of w.instruction.split('\n')) {
    const quoted = /["“]([^"”]+)["”]/.exec(line);
    if (quoted && quoted[1].trim().toLowerCase() === want) return line;
  }
  return null;
}

/** Messages within this many minutes of a closing PD-4's quake origin belong to the same event. */
const BMKG_SAME_EVENT_MINUTES = 15;

/**
 * BMKG InaTEWS last30tsunamievent.xml: one warning per <info>. A message is ended when a PD-4 /
 * "berakhir" message for the same quake (origin time within 15 minutes; magnitudes and locations are
 * revised between messages, so they are not used to match) was issued at or after it.
 */
export function parseBmkgTsunami(raw: unknown, meta: ParseMeta): FeedParseResult {
  if (typeof raw !== 'string' || !raw.includes('<info')) throw new Error('not a BMKG InaTEWS XML document');
  const feed = FEEDS.bmkgInatews;
  const parsed = xmlBlocks(raw, 'info').map((block, i) => {
    const top = block.replace(/<(wzarea|obsarea)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '');
    const subject = xmlText(top, 'subject');
    const headline = xmlText(top, 'headline');
    const coords = (xmlText(top, 'coordinates') ?? '').split(',').map((v) => num(v));
    const areas: OfficialWarningArea[] = xmlBlocks(block, 'wzarea').map((w) => ({
      name: xmlText(w, 'district') ?? xmlText(w, 'province') ?? '',
      level: xmlText(w, 'level'),
      lat: null,
      lon: null,
      province: xmlText(w, 'province'),
    }));
    const observations = bmkgObservations(block);
    let level: string | null = null;
    for (const a of areas) {
      if (a.level && (level === null || (BMKG_LEVEL_RANK[a.level.toUpperCase()] ?? 0) > (BMKG_LEVEL_RANK[level.toUpperCase()] ?? 0))) {
        level = a.level;
      }
    }
    const instruction = ['instruction', 'instruction1', 'instruction2', 'instruction3']
      .map((t) => xmlText(top, t))
      .filter((t): t is string => t !== null)
      .join('\n');
    const closes = /PD-4/i.test(subject ?? '') || /berakhir/i.test(headline ?? '');
    const origin = bmkgOriginMs(xmlText(top, 'date'), xmlText(top, 'time'));
    const eventKey = `${xmlText(top, 'date') ?? ''}|${xmlText(top, 'time') ?? ''}`;
    return {
      eventKey,
      origin,
      closes,
      warning: base(feed, meta, {
        id: `${feed.id}:${xmlText(top, 'eventid') ?? `info-${i}`}`,
        authority: 'official',
        hazard: 'tsunami',
        product: subject ?? 'BMKG InaTEWS message',
        level: level ?? subject ?? 'BMKG InaTEWS message',
        levelGloss: null,
        headline: headline ?? subject ?? '',
        areaDescription: xmlText(top, 'area') ?? '',
        areas,
        location: validLatLon(coords[1] ?? null, coords[0] ?? null),
        issuedAt: wibToUtc(xmlText(top, 'timesent')),
        expiresAt: null,
        ended: false,
        instruction: instruction === '' ? null : instruction,
        language: 'id',
        sourceUrl: feed.url,
        ...(observations.length > 0 ? { observations } : {}),
      }),
    };
  });
  const closers = parsed.filter((p) => p.closes);
  const issuedMs = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
  const isClosed = (p: (typeof parsed)[number]) =>
    closers.some((c) => {
      const sameEvent =
        p.origin !== null && c.origin !== null
          ? Math.abs(p.origin - c.origin) <= BMKG_SAME_EVENT_MINUTES * 60000
          : p.eventKey === c.eventKey;
      const a = issuedMs(p.warning.issuedAt);
      const b = issuedMs(c.warning.issuedAt);
      return sameEvent && (!Number.isFinite(a) || !Number.isFinite(b) || a <= b);
    });
  const warnings = parsed.map((p) => ({ ...p.warning, ended: isClosed(p) }));
  const open = warnings.filter((w) => !w.ended).length;
  return {
    warnings,
    gauges: [],
    note: `${warnings.length} InaTEWS tsunami messages in the last-30-events file; ${open} not ended by a PD-4 message.`,
  };
}

/** BMKG datagempa.json: the latest felt or significant earthquake, with "potential" (tsunami potential) verbatim as the level. */
export function parseBmkgGempa(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.bmkgGempa;
  const info = isRecord(raw) && isRecord(raw.info) ? raw.info : null;
  if (!info) throw new Error('not a BMKG datagempa document');
  const point = isRecord(info.point) ? str(info.point.coordinates) : null;
  const coords = (point ?? '').split(',').map((v) => num(v));
  const subject = str(info.subject);
  const potential = str(info.potential);
  const magnitude = str(info.magnitude);
  const headline =
    str(info.headline) ?? `BMKG ${subject ?? 'earthquake information'}: magnitude ${magnitude ?? 'not given'}`;
  const warning = base(feed, meta, {
    id: `${feed.id}:${str(isRecord(raw) ? raw.identifier : null) ?? str(info.eventid) ?? 'latest'}`,
    authority: 'official',
    hazard: 'earthquake',
    product: subject ?? 'BMKG earthquake information',
    level: potential ?? subject ?? 'BMKG earthquake information',
    levelGloss: null,
    headline,
    areaDescription: str(info.area) ?? '',
    areas: [],
    location: validLatLon(coords[1] ?? null, coords[0] ?? null),
    issuedAt: wibToUtc(info.timesent) ?? wibToUtc(isRecord(raw) ? raw.sent : null),
    expiresAt: null,
    ended: false,
    instruction: str(info.instruction),
    language: 'id',
    sourceUrl: feed.url,
  });
  return { warnings: [warning], gauges: [], note: 'Latest BMKG earthquake information message.' };
}

/** JMA bosai tsunami products that carry a forecast per coastal area (warnings/advisories/forecasts; tsunami information). */
const JMA_FORECAST_PRODUCT = /_VTSE(41|51)_/;
/** At most this many events (newest first) have their newest forecast product fetched. */
export const JMA_MAX_EVENTS = 5;

/**
 * From JMA's list.json, the newest forecast product (VTSE41/VTSE51) of each event (`eid`), newest event
 * first, at most JMA_MAX_EVENTS. Products without a per-area forecast (e.g. VTSE52 offshore observations)
 * are skipped, so they never replace an event's forecast; one event never replaces another.
 */
export function jmaNewestForecastPerEvent(list: unknown): Record<string, unknown>[] {
  const items = Array.isArray(list) ? list.filter(isRecord) : [];
  const newest = new Map<string, Record<string, unknown>>();
  for (const it of items) {
    const json = str(it.json);
    if (!json || !JMA_FORECAST_PRODUCT.test(json)) continue;
    const eid = str(it.eid) ?? json;
    const prev = newest.get(eid);
    if (!prev || (str(it.rdt) ?? '') > (str(prev.rdt) ?? '')) newest.set(eid, it);
  }
  return [...newest.values()].sort((a, b) => (str(b.rdt) ?? '').localeCompare(str(a.rdt) ?? '')).slice(0, JMA_MAX_EVENTS);
}

interface JmaDetail {
  detail: Record<string, unknown>;
  url: string;
}

/**
 * The detail documents in a JMA raw payload. Current shape: { list, details: [{ url, detail }] } (one per
 * event). Older snapshots: { list, detail, detailUrl } (the single newest product). If two documents are
 * for the same EventID, only the newest ReportDateTime is kept: JMA's newest forecast replaces the older one.
 */
function jmaDetails(raw: Record<string, unknown>, fallbackUrl: string): JmaDetail[] {
  const out: JmaDetail[] = [];
  if (Array.isArray(raw.details)) {
    for (const d of raw.details) {
      if (isRecord(d) && isRecord(d.detail)) out.push({ detail: d.detail, url: str(d.url) ?? fallbackUrl });
    }
  } else if (isRecord(raw.detail)) {
    out.push({ detail: raw.detail, url: str(raw.detailUrl) ?? fallbackUrl });
  }
  const head = (d: JmaDetail) => (isRecord(d.detail.Head) ? d.detail.Head : {});
  const reportMs = (d: JmaDetail) => {
    const iso = toUtcIso(head(d).ReportDateTime);
    return iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY;
  };
  const byEvent = new Map<string, JmaDetail>();
  out.forEach((d, i) => {
    const key = str(head(d).EventID) ?? `#${i}`;
    const prev = byEvent.get(key);
    if (!prev || reportMs(d) > reportMs(prev)) byEvent.set(key, d);
  });
  return [...byEvent.values()].sort((a, b) => reportMs(b) - reportMs(a));
}

/** One warning per forecast area of one JMA detail document. */
function parseJmaDetail(detail: Record<string, unknown>, detailUrl: string, meta: ParseMeta): OfficialWarning[] {
  const feed = FEEDS.jmaTsunami;
  const head = isRecord(detail.Head) ? detail.Head : {};
  const body = isRecord(detail.Body) ? detail.Body : {};
  const forecast = isRecord(body.Tsunami) && isRecord(body.Tsunami.Forecast) ? body.Tsunami.Forecast : {};
  const items = Array.isArray(forecast.Item) ? forecast.Item : [];
  const comments = isRecord(body.Comments) && isRecord(body.Comments.WarningComment) ? body.Comments.WarningComment : {};
  const issuedAt = toUtcIso(head.ReportDateTime);
  const expiresAt = toUtcIso(head.ValidDateTime);
  const cancelled = str(head.InfoType) === '取消';
  const title = str(head.enTitle) ? `${str(head.enTitle)} (${str(head.Title) ?? ''})` : (str(head.Title) ?? 'JMA tsunami information');
  const warnings: OfficialWarning[] = [];
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.Area)) continue;
    const kind = isRecord(item.Category) && isRecord(item.Category.Kind) ? item.Category.Kind : {};
    const kindJa = str(kind.Name);
    const kindEn = str(kind.enName);
    const level = kindEn && kindJa ? `${kindEn} (${kindJa})` : (kindEn ?? kindJa ?? 'JMA tsunami information');
    const areaName = str(item.Area.enName) && str(item.Area.Name) ? `${str(item.Area.enName)} (${str(item.Area.Name)})` : (str(item.Area.enName) ?? str(item.Area.Name) ?? '');
    const max = isRecord(item.MaxHeight) ? item.MaxHeight : {};
    const height = str(max.TsunamiHeight);
    const condition = str(max.Condition);
    const heightText = height ? `, maximum tsunami height ${height} m` : condition ? `, ${condition}` : '';
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${str(head.EventID) ?? 'event'}:${str(item.Area.Code) ?? areaName}:${str(head.ReportDateTime) ?? ''}`,
        authority: 'official',
        hazard: 'tsunami',
        product: title,
        level,
        levelGloss: null,
        headline: `${str(head.enTitle) ?? str(head.Title) ?? 'Tsunami information'}: ${areaName}${heightText}`,
        areaDescription: areaName,
        areas: [{ name: areaName, level, lat: null, lon: null }],
        location: null,
        issuedAt,
        expiresAt,
        ended: cancelled || (kindJa ?? '').includes('解除') || expired(expiresAt, meta.retrievedAt),
        instruction: str(comments.enText) ?? str(comments.Text),
        language: 'en',
        sourceUrl: detailUrl,
      }),
    );
  }
  return warnings;
}

/**
 * JMA tsunami: the newest forecast product of each event in list.json (jmaNewestForecastPerEvent), one
 * warning per forecast area. An event's older products are not shown: its newest forecast replaces them.
 */
export function parseJmaTsunami(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.jmaTsunami;
  if (!isRecord(raw) || !Array.isArray(raw.list)) throw new Error('not a JMA tsunami list');
  const details = jmaDetails(raw, feed.url);
  const missing = Array.isArray(raw.details) ? raw.details.filter((d) => !isRecord(d) || !isRecord(d.detail)).length : 0;
  const missingNote = missing > 0 ? ` ${missing} event product${missing === 1 ? '' : 's'} could not be fetched: check JMA directly.` : '';
  if (details.length === 0) {
    return { warnings: [], gauges: [], note: `JMA lists no tsunami message. Not an all-clear; check JMA directly.${missingNote}` };
  }
  const warnings = details.flatMap((d) => parseJmaDetail(d.detail, d.url, meta));
  const open = warnings.filter((w) => !w.ended).length;
  const products = details.map((d) => {
    const head = isRecord(d.detail.Head) ? d.detail.Head : {};
    return `${str(head.enTitle) ?? str(head.Title) ?? ''} issued ${toUtcIso(head.ReportDateTime) ?? 'at an unknown time'}`;
  });
  const lead = details.length === 1 ? `Latest JMA product ${products[0]}` : `Newest JMA forecast for each of ${details.length} events (${products.join('; ')})`;
  return { warnings, gauges: [], note: `${lead}: ${warnings.length} areas, ${open} not ended or expired.${missingNote}` };
}

/** JMA volcano warnings in force (warning.json) joined to volcano_list.json for English names and coordinates. */
export function parseJmaVolcano(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.jmaVolcano;
  if (!isRecord(raw) || !Array.isArray(raw.warning)) throw new Error('not a JMA volcano warning list');
  const volcanoes = new Map<string, Record<string, unknown>>();
  for (const v of Array.isArray(raw.volcanoList) ? raw.volcanoList : []) {
    if (isRecord(v) && typeof v.code === 'string') volcanoes.set(v.code, v);
  }
  const warnings: OfficialWarning[] = [];
  for (const entry of raw.warning) {
    if (!isRecord(entry) || !Array.isArray(entry.volcanoInfos)) continue;
    const infos = entry.volcanoInfos.filter(isRecord);
    const target = infos.find((v) => (str(v.type) ?? '').includes('対象火山'));
    const towns = infos.find((v) => (str(v.type) ?? '').includes('対象市町村等'));
    const response = infos.find((v) => (str(v.type) ?? '').includes('防災対応'));
    const itemsOf = (info: Record<string, unknown> | undefined): unknown[] =>
      info && Array.isArray(info.items) ? info.items : [];
    const townNames = itemsOf(towns)
      .flatMap((it) => (isRecord(it) && Array.isArray(it.areas) ? it.areas : []))
      .map((a) => (isRecord(a) ? str(a.name) : null))
      .filter((n): n is string => n !== null);
    const responseText = itemsOf(response)
      .map((it) => (isRecord(it) ? str(it.name) : null))
      .filter((n): n is string => n !== null);
    for (const item of itemsOf(target)) {
      if (!isRecord(item)) continue;
      const area = Array.isArray(item.areas) && isRecord(item.areas[0]) ? item.areas[0] : {};
      const code = str(area.code);
      const v = code ? volcanoes.get(code) : undefined;
      const nameJa = str(area.name) ?? str(v?.name_jp) ?? '';
      const nameEn = str(v?.name_en);
      const latlon: unknown[] = v && Array.isArray(v.latlon) ? v.latlon : [];
      const location = validLatLon(num(latlon[0]), num(latlon[1]));
      const levelText = str(item.name) ?? '';
      const condition = str(item.condition);
      const volcanoName = nameEn ? `${nameEn} (${nameJa})` : nameJa;
      warnings.push(
        base(feed, meta, {
          id: `${feed.id}:${code ?? nameJa}:${str(entry.reportDatetime) ?? ''}`,
          authority: 'official',
          hazard: 'volcano',
          product: str(target?.type) ?? '噴火警報・予報',
          level: levelText,
          levelGloss: jmaVolcanoGloss(str(item.code), levelText),
          headline: `${volcanoName}: ${levelText}${condition ? `（${condition}）` : ''}`,
          areaDescription: townNames.length > 0 ? townNames.join('、') : volcanoName,
          areas: [
            { name: volcanoName, level: levelText, lat: location?.lat ?? null, lon: location?.lon ?? null },
            ...townNames.map((n) => ({ name: n, level: null, lat: null, lon: null })),
          ],
          location,
          issuedAt: toUtcIso(entry.reportDatetime),
          expiresAt: null,
          ended: false,
          instruction: responseText.length > 0 ? responseText.join('\n') : null,
          language: 'ja',
          sourceUrl: feed.url,
        }),
      );
    }
  }
  return { warnings, gauges: [], note: `${warnings.length} JMA volcano warnings or forecasts in force.` };
}

/** GeoNet Volcanic Alert Levels: no issue time is published (issuedAt null; show retrievedAt). */
export function parseGeonetVal(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.geonet;
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error('not a GeoNet VAL feature collection');
  const warnings: OfficialWarning[] = [];
  for (const f of raw.features) {
    if (!isRecord(f) || !isRecord(f.properties)) continue;
    const p = f.properties;
    const coords = isRecord(f.geometry) && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
    const level = str(p.level);
    // Level 0 is GeoNet's "no volcanic unrest": a status, not a warning, so it is not relayed (lead decision 2026-10-13).
    if (level === '0') continue;
    const title = str(p.volcanoTitle) ?? str(p.volcanoID) ?? '';
    const parts = [str(p.activity), str(p.acc) ? `Aviation Colour Code: ${str(p.acc)}.` : null, str(p.hazards) ? `Hazards: ${str(p.hazards)}` : null];
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${str(p.volcanoID) ?? title}`,
        authority: 'official',
        hazard: 'volcano',
        product: 'Volcanic Alert Level',
        level: level === null ? 'Volcanic Alert Level not given' : `Volcanic Alert Level ${level}`,
        levelGloss: null,
        headline: `${title}: ${parts.filter((x): x is string => x !== null).join(' ')}`,
        areaDescription: title,
        areas: [{ name: title, level: level === null ? null : `Volcanic Alert Level ${level}`, lat: num(coords[1]), lon: num(coords[0]) }],
        location: validLatLon(num(coords[1]), num(coords[0])),
        issuedAt: null,
        expiresAt: null,
        ended: false,
        instruction: null,
        language: 'en',
        sourceUrl: feed.url,
      }),
    );
  }
  return { warnings, gauges: [], note: `${warnings.length} GeoNet Volcanic Alert Levels (GeoNet publishes no issue time for these).` };
}

function polygonCentroid(geometry: unknown): { lat: number; lon: number } | null {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return null;
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates[0]) ? geometry.coordinates[0][0] : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const pt of ring) {
    if (Array.isArray(pt) && num(pt[0]) !== null && num(pt[1]) !== null) {
      lon += num(pt[0]) as number;
      lat += num(pt[1]) as number;
      n += 1;
    }
  }
  return n > 0 ? validLatLon(lat / n, lon / n) : null;
}

/** NWS tsunami alerts for Guam, CNMI, American Samoa and Hawaii. */
export function parseNwsAlerts(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.nws;
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error('not an NWS alerts feature collection');
  const warnings: OfficialWarning[] = [];
  for (const f of raw.features) {
    if (!isRecord(f) || !isRecord(f.properties)) continue;
    const p = f.properties;
    const expiresAt = toUtcIso(p.expires) ?? toUtcIso(p.ends);
    const event = str(p.event) ?? 'NWS alert';
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${str(p.id) ?? str(f.id) ?? event}`,
        authority: 'official',
        hazard: 'tsunami',
        product: event,
        level: event,
        levelGloss: null,
        headline: str(p.headline) ?? event,
        areaDescription: str(p.areaDesc) ?? '',
        areas: str(p.areaDesc) ? [{ name: str(p.areaDesc) as string, level: event, lat: null, lon: null }] : [],
        location: polygonCentroid(f.geometry),
        issuedAt: toUtcIso(p.sent),
        expiresAt,
        ended: str(p.messageType) === 'Cancel' || expired(expiresAt, meta.retrievedAt),
        instruction: str(p.instruction),
        language: 'en',
        sourceUrl: str(p['@id']) ?? str(f.id) ?? feed.url,
      }),
    );
  }
  const at = toUtcIso(raw.updated) ?? meta.retrievedAt;
  return {
    warnings,
    gauges: [],
    note:
      warnings.length > 0
        ? `${warnings.length} NWS tsunami alerts for US Pacific territories.`
        : `No active NWS tsunami alerts for Guam, CNMI, American Samoa or Hawaii at ${at}. Not an all-clear for other areas.`,
  };
}

const GDACS_HAZARDS: Record<string, WarningHazard> = { EQ: 'earthquake', TS: 'tsunami', VO: 'volcano', FL: 'flood', TC: 'weather' };

/** Asia-Pacific box used for GDACS (and by the snapshot script). */
export function inApac(lat: number, lon: number): boolean {
  return lat >= -50 && lat <= 55 && ((lon >= 60 && lon <= 180) || (lon >= -180 && lon <= -140));
}

export const GDACS_PREFIX = 'Impact estimate (GDACS), not an official warning';

/** GDACS events (aggregator): alertlevel verbatim, headline prefixed so it is never read as a warning. */
export function parseGdacs(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.gdacs;
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error('not a GDACS feature collection');
  const warnings: OfficialWarning[] = [];
  for (const f of raw.features) {
    if (!isRecord(f) || !isRecord(f.properties)) continue;
    const p = f.properties;
    const coords = isRecord(f.geometry) && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
    const location = validLatLon(num(coords[1]), num(coords[0]));
    if (!location || !inApac(location.lat, location.lon)) continue;
    const type = str(p.eventtype) ?? '';
    const url = isRecord(p.url) ? str(p.url.report) : null;
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${type}${str(p.eventid) ?? ''}:${str(p.episodeid) ?? ''}`,
        authority: 'aggregator',
        hazard: GDACS_HAZARDS[type] ?? 'other',
        product: str(p.name) ?? `GDACS ${type} event`,
        level: str(p.alertlevel) ?? 'not given',
        levelGloss: null,
        headline: `${GDACS_PREFIX}: ${str(p.htmldescription) ?? str(p.description) ?? str(p.name) ?? ''}`,
        areaDescription: str(p.country) ?? '',
        areas: [],
        location,
        issuedAt: gdacsToUtc(p.datemodified) ?? gdacsToUtc(p.fromdate),
        expiresAt: null,
        ended: str(p.iscurrent) === 'false',
        instruction: null,
        language: 'en',
        sourceUrl: url ?? feed.url,
      }),
    );
  }
  return { warnings, gauges: [], note: `${warnings.length} GDACS impact estimates in the Asia-Pacific box (aggregator, not official warnings).` };
}

/** MAGMA level text -> fixed, reviewed gloss (verbatim level texts from the public level list). */
const MAGMA_GLOSS: Record<string, string> = {
  'Level I (Normal)': 'Level 1 of 4 (Normal)',
  'Level II (Waspada)': 'Level 2 of 4 (Advisory)',
  'Level III (Siaga)': 'Level 3 of 4 (Alert)',
  'Level IV (Awas)': 'Level 4 of 4 (Warning, the highest)',
};

/** Smithsonian GVP coordinates for the watched volcanoes, used if the snapshot has none. */
const MAGMA_FALLBACK_COORDS: Record<string, { gvpNumber: string; lat: number; lon: number }> = {
  'anak krakatau': { gvpNumber: '262000', lat: -6.1009, lon: 105.4233 },
  merapi: { gvpNumber: '263250', lat: -7.54, lon: 110.446 },
  semeru: { gvpNumber: '263300', lat: -8.108, lon: 112.922 },
  sinabung: { gvpNumber: '261080', lat: 3.17, lon: 98.392 },
};

/** Capture time of the bundled MAGMA records (from data/warnings-snapshot.json), or null. */
export const MAGMA_RETRIEVED_AT: string | null =
  (snapshotJson as unknown as { feeds?: Record<string, { retrievedAt?: unknown }> }).feeds?.['magma-level-list']
    ?.retrievedAt as string | null ?? null;

/**
 * MAGMA Indonesia level-list records from the snapshot (written by scripts/capture-warnings-snapshot.mjs
 * from the public level list; MAGMA's API is token-only). raw = { volcanoes: [{ name, region, level, lat?, lon?, gvpNumber? }] }.
 */
export function parseMagmaSnapshot(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.magma;
  const list = isRecord(raw) && Array.isArray(raw.volcanoes) ? raw.volcanoes.filter(isRecord) : null;
  if (!list || list.length === 0) throw new Error('no MAGMA records in the snapshot');
  const date = meta.retrievedAt.slice(0, 10);
  const warnings: OfficialWarning[] = [];
  for (const v of list) {
    const name = str(v.name);
    const level = str(v.level);
    if (!name || !level) continue;
    const region = str(v.region);
    const fallback = MAGMA_FALLBACK_COORDS[name.toLowerCase()];
    const location = validLatLon(num(v.lat), num(v.lon)) ?? (fallback ? { lat: fallback.lat, lon: fallback.lon } : null);
    const gvp = str(v.gvpNumber) ?? fallback?.gvpNumber ?? null;
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${gvp ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${meta.retrievedAt}`,
        authority: 'official',
        hazard: 'volcano',
        product: 'Tingkat Aktivitas Gunung Api (MAGMA Indonesia level list)',
        level,
        levelGloss: MAGMA_GLOSS[level] ?? null,
        headline:
          `${name}: ${level}, as recorded from MAGMA Indonesia's public volcano activity level list on ${date}. ` +
          'Check MAGMA for the current level.',
        areaDescription: region ? `${name} - ${region}` : name,
        areas: [{ name, level, lat: location?.lat ?? null, lon: location?.lon ?? null }],
        location,
        issuedAt: null,
        expiresAt: null,
        ended: false,
        instruction: null,
        language: 'id',
        sourceUrl: feed.url,
      }),
    );
  }
  if (warnings.length === 0) throw new Error('no usable MAGMA records in the snapshot');
  return {
    warnings,
    gauges: [],
    note:
      `Recorded from MAGMA's public level list at ${meta.retrievedAt}; MAGMA's API is token-only. ` +
      'Check MAGMA for the current level.',
  };
}

/** The bundled MAGMA records (historical), or an empty result when the snapshot has none. */
export function magmaRecords(source: WarningsSnapshot | null = BUNDLED_WARNINGS_SNAPSHOT): FeedParseResult {
  const snap = source?.feeds?.[FEEDS.magma.id];
  if (!snap || typeof snap.retrievedAt !== 'string') return { warnings: [], gauges: [], note: null };
  try {
    return parseMagmaSnapshot(snap.raw, { dataMode: 'historical', retrievedAt: snap.retrievedAt });
  } catch {
    return { warnings: [], gauges: [], note: null };
  }
}

/** ThaiWater waterlevel_load: every gauge as a GaugeReading; gauges at THAIWATER_RELAY_MIN_LEVEL or above as flood warnings. */
export function parseThaiWater(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.thaiwater;
  const rows = isRecord(raw) && isRecord(raw.waterlevel_data) && Array.isArray(raw.waterlevel_data.data) ? raw.waterlevel_data.data : null;
  if (!rows) throw new Error('not a ThaiWater waterlevel_load document');
  const scaleRows =
    isRecord(raw) && isRecord(raw.scale) && isRecord(raw.scale.data) && Array.isArray(raw.scale.data.scale) ? raw.scale.data.scale : [];
  const situationText = new Map<number, string>();
  for (const s of scaleRows) {
    const m = isRecord(s) ? /waterlevel_level_(\d)/.exec(str(s.trans) ?? '') : null;
    if (m && isRecord(s) && str(s.situation)) situationText.set(Number(m[1]), str(s.situation) as string);
  }
  const gauges: GaugeReading[] = [];
  const warnings: OfficialWarning[] = [];
  let withoutText = 0;
  for (const r of rows) {
    if (!isRecord(r) || !isRecord(r.station)) continue;
    const st = r.station;
    const loc = validLatLon(num(st.tele_station_lat), num(st.tele_station_long));
    const observedAt = ictToUtc(r.waterlevel_datetime);
    const msl = num(r.waterlevel_msl);
    const local = num(r.waterlevel_m);
    const value = msl ?? local;
    if (!loc || !observedAt || value === null) continue;
    const code = str(st.tele_station_oldcode) ?? str(st.id) ?? '';
    const names = isRecord(st.tele_station_name) ? st.tele_station_name : {};
    const name = [code, str(names.en) ?? str(names.th)].filter((x): x is string => x !== null && x !== '').join(' ');
    const level = num(r.situation_level);
    const situation = level !== null ? (situationText.get(level) ?? null) : null;
    const situationGloss = level !== null ? (THAIWATER_GLOSS[level] ?? null) : null;
    const datum = msl !== null ? 'MSL' : 'local gauge datum';
    const thresholds: Record<string, number> = {};
    for (const [k, field] of [['minBank', 'min_bank'], ['leftBank', 'left_bank'], ['rightBank', 'right_bank'], ['criticalLevelMsl', 'critical_level_msl']] as const) {
      const n = num(st[field]);
      if (n !== null && (datum === 'MSL' || k !== 'criticalLevelMsl')) thresholds[k] = n;
    }
    gauges.push({
      id: `${feed.id}:${code}`,
      name,
      issuer: feed.issuer,
      lat: loc.lat,
      lon: loc.lon,
      observedAt,
      value,
      unit: 'm',
      datum,
      situation,
      situationLevel: level,
      situationGloss,
      thresholds: Object.keys(thresholds).length > 0 ? thresholds : null,
      sourceUrl: feed.url,
      dataMode: meta.dataMode,
      retrievedAt: meta.retrievedAt,
    });
    if (level === null || level < THAIWATER_RELAY_MIN_LEVEL) continue;
    // ThaiWater's situation text comes from its `scale` table. If that table is missing or changed, the
    // gauge is still relayed (never dropped silently) under its numeric level, and the note says so.
    if (!situation) withoutText += 1;
    const levelLabel = situation ?? `ThaiWater situation_level ${level}`;
    // diff_wl_bank is an unsigned amount; the direction is only in ThaiWater's own text:
    // "ล้นตลิ่ง" (overflowing the bank) or "ต่ำกว่าตลิ่ง" (below the bank). Relay both verbatim.
    const diff = str(r.diff_wl_bank);
    const diffText = str(r.diff_wl_bank_text);
    const bank = num(st.min_bank);
    const discharge = num(r.discharge);
    const direction = diffText?.includes('ต่ำกว่า') ? 'below' : diffText?.includes('ล้น') ? 'above' : null;
    const bankText =
      diff === null
        ? 'position relative to the bank not given'
        : `${diff} m ${direction ?? 'from'} the lowest bank${bank !== null ? ` (${bank} m ${datum})` : ''}` +
          `${diffText ? ` [${diffText}]` : ''}`;
    const geo = isRecord(r.geocode) ? r.geocode : {};
    const nameOf = (v: unknown) => (isRecord(v) ? (str(v.en) ?? str(v.th)) : null);
    const basin = isRecord(r.basin) ? nameOf(r.basin.basin_name) : null;
    const agency = isRecord(r.agency) ? nameOf(r.agency.agency_shortname) : null;
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${code}:${observedAt}`,
        authority: 'official',
        hazard: 'flood',
        product: `ThaiWater water level situation${agency ? ` (${agency} gauge)` : ''}`,
        level: levelLabel,
        levelGloss: situationGloss,
        headline:
          `${name}: water level ${value} m ${datum}, ${bankText}, discharge ` +
          `${discharge !== null ? `${discharge} m³/s` : 'not reported'} (ThaiWater ${str(r.waterlevel_datetime) ?? ''} ICT)`,
        areaDescription: [nameOf(geo.amphoe_name), nameOf(geo.province_name), basin].filter((x): x is string => x !== null).join(', '),
        areas: [{ name, level: levelLabel, lat: loc.lat, lon: loc.lon }],
        location: loc,
        issuedAt: observedAt,
        expiresAt: null,
        ended: false,
        instruction: null,
        language: 'th',
        sourceUrl: feed.url,
      }),
    );
  }
  return {
    warnings,
    gauges,
    note:
      `${gauges.length} ThaiWater gauges read; ${warnings.length} at situation level ${THAIWATER_RELAY_MIN_LEVEL} or above relayed.` +
      (withoutText > 0
        ? ` ${withoutText} of them without ThaiWater's situation text (its scale table was missing from the response): check ThaiWater directly.`
        : ''),
  };
}

/** Jakarta DSDA floodgates: every gate as a GaugeReading (cm); gates whose STATUS_SIAGA is not Normal as flood warnings. */
export function parseDsda(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.dsda;
  if (typeof raw !== 'string' || !raw.includes('SP_GET_LAST_STATUS_PINTU_AIR')) throw new Error('not a DSDA floodgate XML document');
  const gauges: GaugeReading[] = [];
  const warnings: OfficialWarning[] = [];
  for (const block of xmlBlocks(raw, 'SP_GET_LAST_STATUS_PINTU_AIR')) {
    const name = xmlText(block, 'NAMA_PINTU_AIR');
    const loc = validLatLon(num(xmlText(block, 'LATITUDE')), num(xmlText(block, 'LONGITUDE')));
    const observedAt = toUtcIso(xmlText(block, 'TANGGAL'));
    const mm = num(xmlText(block, 'TINGGI_AIR'));
    if (!name || !loc || !observedAt || mm === null) continue;
    const status = xmlText(block, 'STATUS_SIAGA');
    const thresholds: Record<string, number> = {};
    for (const k of ['1', '2', '3', '4']) {
      const t = num(xmlText(block, `SIAGA${k}`));
      if (t !== null) thresholds[`siaga${k}`] = t / 10;
    }
    const id = xmlText(block, 'ID_PINTU_AIR') ?? name;
    const cm = mm / 10;
    gauges.push({
      id: `${feed.id}:${id}`,
      name,
      issuer: feed.issuer,
      lat: loc.lat,
      lon: loc.lon,
      observedAt,
      value: cm,
      unit: 'cm',
      datum: 'gauge zero (DSDA)',
      situation: status,
      thresholds: Object.keys(thresholds).length > 0 ? thresholds : null,
      sourceUrl: feed.url,
      dataMode: meta.dataMode,
      retrievedAt: meta.retrievedAt,
    });
    if (!status || /normal/i.test(status)) continue;
    const siaga = /Siaga\s*([1-4])/i.exec(status)?.[1] ?? null;
    const river = xmlText(block, 'LOKASI');
    const thresholdText = ['1', '2', '3', '4']
      .filter((k) => thresholds[`siaga${k}`] !== undefined)
      .map((k) => `Siaga ${k} ${thresholds[`siaga${k}`]} cm`)
      .join(', ');
    warnings.push(
      base(feed, meta, {
        id: `${feed.id}:${id}:${observedAt}`,
        authority: 'official',
        hazard: 'flood',
        product: 'Status pintu air (Posko Banjir DSDA)',
        level: status,
        levelGloss: siaga ? DSDA_GLOSS[siaga] : null,
        headline: `${name}${river ? ` (${river})` : ''}: water level ${cm} cm; DSDA Siaga thresholds: ${thresholdText}`,
        areaDescription: [name, river, xmlText(block, 'FILE_EXPORT')].filter((x): x is string => x !== null).join(', '),
        areas: [{ name, level: status, lat: loc.lat, lon: loc.lon }],
        location: loc,
        issuedAt: observedAt,
        expiresAt: null,
        ended: false,
        instruction: null,
        language: 'id',
        sourceUrl: feed.url,
      }),
    );
  }
  return {
    warnings,
    gauges,
    note: `${gauges.length} DSDA gates read; ${warnings.length} above Normal relayed. BPBD DKI Jakarta issues evacuations.`,
  };
}

const PUB_LEVEL_FIELDS = ['status', 'severity', 'alertLevel', 'level', 'type', 'category'];
const PUB_TEXT_FIELDS = ['message', 'text', 'description', 'headline', 'title', 'name'];
const PUB_AREA_FIELDS = ['location', 'area', 'areaName', 'stationName', 'region', 'name'];

function firstText(r: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = str(r[f]);
    if (v) return v;
  }
  return null;
}

/** PUB flood alerts. The populated schema was never observed, so known-looking fields are relayed and the raw JSON is kept as the headline otherwise. */
export function parsePubFlood(raw: unknown, meta: ParseMeta): FeedParseResult {
  const feed = FEEDS.pub;
  const records = isRecord(raw) && isRecord(raw.data) && Array.isArray(raw.data.records) ? raw.data.records.filter(isRecord) : null;
  if (!records) throw new Error('not a data.gov.sg flood-alerts document');
  const latest = [...records].sort((a, b) => (toUtcIso(b.datetime) ?? '').localeCompare(toUtcIso(a.datetime) ?? ''))[0];
  const at = latest ? (toUtcIso(latest.datetime) ?? meta.retrievedAt) : meta.retrievedAt;
  const readings = latest && isRecord(latest.item) && Array.isArray(latest.item.readings) ? latest.item.readings : [];
  const warnings: OfficialWarning[] = readings.map((reading, i) => {
    const r = isRecord(reading) ? reading : {};
    const lat = num(r.latitude) ?? (isRecord(r.location) ? num(r.location.latitude) : null);
    const lon = num(r.longitude) ?? (isRecord(r.location) ? num(r.location.longitude) : null);
    const level = firstText(r, PUB_LEVEL_FIELDS) ?? 'PUB flood alert (no level field in the message)';
    return base(feed, meta, {
      id: `${feed.id}:${str(r.id) ?? `${at}-${i}`}`,
      authority: 'official',
      hazard: 'flood',
      product: 'PUB flood alert',
      level,
      levelGloss: null,
      headline: firstText(r, PUB_TEXT_FIELDS) ?? JSON.stringify(reading),
      areaDescription: firstText(r, PUB_AREA_FIELDS) ?? '',
      areas: [],
      location: validLatLon(lat, lon),
      issuedAt: at,
      expiresAt: null,
      ended: false,
      instruction: str(r.instruction) ?? str(r.advice),
      language: 'en',
      sourceUrl: feed.url,
    });
  });
  return {
    warnings,
    gauges: [],
    note: warnings.length > 0 ? `${warnings.length} active PUB flood alerts at ${at}.` : `No active PUB flood alerts at ${at}`,
  };
}

// ---------------------------------------------------------------------------
// Proximity and ordering

type LatLon = { lat: number; lon: number };

/**
 * The points a warning is matched on. A tsunami message that names its warned areas is matched on those
 * areas only, never on the quake epicentre in `location`: the issuer warned those coasts, so a watch
 * next to a warned district is matched even when the epicentre is far away, and a watch next to the
 * epicentre is not matched when its coast was not warned. Areas without coordinates of their own are
 * placed where possible (BMKG InaTEWS districts at their geoBoundaries centres, see tsunamiAreas.ts);
 * `unplaced` counts the named areas that could not be placed.
 */
export function warningMatchPoints(w: OfficialWarning): { points: LatLon[]; unplaced: number } {
  const own = (a: OfficialWarningArea) => validLatLon(a.lat, a.lon);
  if (w.hazard === 'tsunami' && w.areas.length > 0) {
    const points: LatLon[] = [];
    const needPlacing: OfficialWarningArea[] = [];
    for (const a of w.areas) {
      const p = own(a);
      if (p) points.push(p);
      else needPlacing.push(a);
    }
    if (needPlacing.length === 0) return { points, unplaced: 0 };
    if (!w.id.startsWith(`${FEEDS.bmkgInatews.id}:`)) return { points, unplaced: needPlacing.length };
    const placement = placeTsunamiAreas(needPlacing, idnDistrictIndex());
    return { points: [...points, ...placement.placed.map((p) => ({ lat: p.lat, lon: p.lon }))], unplaced: placement.unplaced.length };
  }
  const points = [w.location, ...w.areas.map(own)].filter((p): p is LatLon => p !== null);
  return { points, unplaced: 0 };
}

/**
 * Smallest distance from a point to the places a warning names (warningMatchPoints: its location or
 * areas; for a tsunami message with named areas, those areas only); null when none has coordinates.
 */
export function warningDistanceKm(w: OfficialWarning, lat: number, lon: number): number | null {
  const { points } = warningMatchPoints(w);
  if (points.length === 0) return null;
  return Math.min(...points.map((p) => haversineKm(lat, lon, p.lat, p.lon)));
}

/** Warnings with a location or area within radiusKm, in the input order. Warnings without coordinates are excluded. */
export function warningsNear(warnings: OfficialWarning[], lat: number, lon: number, radiusKm: number): OfficialWarning[] {
  return warnings.filter((w) => {
    const d = warningDistanceKm(w, lat, lon);
    return d !== null && d <= radiusKm;
  });
}

/** An official tsunami message that is still in force (not ended; with nowMs, not past its expiry). */
function activeOfficialTsunami(w: OfficialWarning, nowMs?: number): boolean {
  if (w.authority !== 'official' || w.hazard !== 'tsunami') return false;
  return nowMs === undefined ? !w.ended : !isExpired(w, nowMs);
}

/**
 * Splits warnings for a selected place:
 * - `near`: warnings whose location or named areas lie within radiusKm (warningsNear);
 * - `elsewhere`: everything else that must still be shown, i.e. warnings with no coordinates at all,
 *   and every official tsunami message still in force that is not near. A tsunami message is never
 *   dropped: one whose warned areas are far away, or only partly placed, is listed here in full.
 * Both lists keep the input order. Without nowMs, "in force" means not ended by the issuer.
 */
export function partitionWarnings(
  warnings: readonly OfficialWarning[],
  lat: number,
  lon: number,
  radiusKm: number,
  nowMs?: number,
): { near: OfficialWarning[]; elsewhere: OfficialWarning[] } {
  const near: OfficialWarning[] = [];
  const elsewhere: OfficialWarning[] = [];
  for (const w of warnings) {
    const d = warningDistanceKm(w, lat, lon);
    if (d !== null && d <= radiusKm) near.push(w);
    else if (d === null || activeOfficialTsunami(w, nowMs)) elsewhere.push(w);
  }
  return { near, elsewhere };
}

/** issuedAt descending, nulls last; then issuer and id for a stable order. */
export function compareWarnings(a: OfficialWarning, b: OfficialWarning): number {
  if (a.issuedAt !== b.issuedAt) {
    if (a.issuedAt === null) return 1;
    if (b.issuedAt === null) return -1;
    return a.issuedAt < b.issuedAt ? 1 : -1;
  }
  if (a.issuer !== b.issuer) return a.issuer < b.issuer ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Loading: per-feed timeout, dedupe, 5-minute cache, 60-second backoff, snapshot fallback

interface FeedSpec {
  key: FeedKey;
  parse: (raw: unknown, meta: ParseMeta) => FeedParseResult;
  /** Fetch the raw payload; absent for bundled-only feeds (MAGMA). */
  fetchRaw?: (get: Getter, nowMs: number) => Promise<unknown>;
  dataGovSg?: boolean;
}

type Getter = (url: string, kind: 'json' | 'text') => Promise<unknown>;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function gdacsSearchUrl(nowMs: number): string {
  return (
    `${FEEDS.gdacs.url}?eventlist=EQ;TS;VO;FL;TC&fromDate=${isoDay(nowMs - 30 * 86400000)}` +
    `&toDate=${isoDay(nowMs)}&alertlevel=green;orange;red`
  );
}

const SPECS: FeedSpec[] = [
  { key: 'bmkgInatews', parse: parseBmkgTsunami, fetchRaw: (get) => get(FEEDS.bmkgInatews.url, 'text') },
  { key: 'bmkgGempa', parse: parseBmkgGempa, fetchRaw: (get) => get(FEEDS.bmkgGempa.url, 'json') },
  {
    key: 'jmaTsunami',
    parse: parseJmaTsunami,
    fetchRaw: async (get) => {
      const list = await get(FEEDS.jmaTsunami.url, 'json');
      const items = Array.isArray(list) ? list.filter(isRecord) : [];
      const urls = jmaNewestForecastPerEvent(items).map((it) => `https://www.jma.go.jp/bosai/tsunami/data/${str(it.json)}`);
      const settled = await Promise.allSettled(urls.map((url) => get(url, 'json')));
      // One event's detail failing must not hide the others; only when every detail fails does the feed fail.
      const firstFailure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (firstFailure && settled.every((r) => r.status === 'rejected')) throw firstFailure.reason;
      const details = settled.map((r, i) => ({ url: urls[i], detail: r.status === 'fulfilled' ? r.value : null }));
      return { list: items, details };
    },
  },
  {
    key: 'jmaVolcano',
    parse: parseJmaVolcano,
    fetchRaw: async (get) => {
      const [warning, volcanoList] = await Promise.all([
        get(FEEDS.jmaVolcano.url, 'json'),
        get('https://www.jma.go.jp/bosai/volcano/const/volcano_list.json', 'json'),
      ]);
      return { warning, volcanoList };
    },
  },
  { key: 'geonet', parse: parseGeonetVal, fetchRaw: (get) => get(FEEDS.geonet.url, 'json') },
  { key: 'nws', parse: parseNwsAlerts, fetchRaw: (get) => get(FEEDS.nws.url, 'json') },
  { key: 'gdacs', parse: parseGdacs, fetchRaw: (get, nowMs) => get(gdacsSearchUrl(nowMs), 'json') },
  { key: 'magma', parse: parseMagmaSnapshot },
  { key: 'thaiwater', parse: parseThaiWater, fetchRaw: (get) => get(FEEDS.thaiwater.url, 'json') },
  { key: 'dsda', parse: parseDsda, fetchRaw: (get) => get(FEEDS.dsda.url, 'text') },
  { key: 'pub', parse: parsePubFlood, fetchRaw: (get) => get(FEEDS.pub.url, 'json'), dataGovSg: true },
];

/** Snapshot feed ids differ from FEEDS keys only for the JMA tsunami detail URL field. */
interface SnapshotFeed {
  retrievedAt: string | null;
  urls?: string[];
  raw: unknown;
  error?: string | null;
}

/** Shape of data/warnings-snapshot.json (see scripts/capture-warnings-snapshot.mjs). */
export interface WarningsSnapshot {
  capturedAt: string;
  feeds: Record<string, SnapshotFeed>;
}

export const BUNDLED_WARNINGS_SNAPSHOT = snapshotJson as unknown as WarningsSnapshot;

function snapshotFeed(id: string, source: WarningsSnapshot | null): SnapshotFeed | null {
  const f = source?.feeds?.[id];
  if (!f || f.raw === null || f.raw === undefined || typeof f.retrievedAt !== 'string') return null;
  // Older snapshots store JMA tsunami as { list, detail }; the detail URL is the second captured URL.
  // Current ones store { list, details: [{ url, detail }] }, which carries its own URLs.
  if (id === FEEDS.jmaTsunami.id && isRecord(f.raw) && !Array.isArray(f.raw.details) && Array.isArray(f.urls) && f.urls[1]) {
    return { ...f, raw: { ...f.raw, detailUrl: f.urls[1] } };
  }
  return f;
}

export const WARNINGS_CACHE_KEY_PREFIX = 'asean-watch:warnings:feed:v1:';
export const WARNINGS_BACKOFF_KEY = 'asean-watch:warnings:backoff:v1';
export const WARNINGS_CACHE_TTL_MS = 5 * 60 * 1000;
export const WARNINGS_BACKOFF_MS = 60 * 1000;

interface FeedCacheEntry {
  storedAt: number;
  retrievedAt: string;
  result: FeedParseResult;
}

const memoryCache = new Map<string, FeedCacheEntry>();
let memoryBackoff: Record<string, { until: number; reason: string }> = {};
let inflight: Promise<OfficialWarningsResult> | null = null;

function storage(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readCache(id: string, now: number): FeedCacheEntry | null {
  const fresh = (e: FeedCacheEntry | null | undefined) =>
    e && now - e.storedAt >= 0 && now - e.storedAt < WARNINGS_CACHE_TTL_MS ? e : null;
  const mem = fresh(memoryCache.get(id));
  if (mem) return mem;
  try {
    const raw = storage()?.getItem(WARNINGS_CACHE_KEY_PREFIX + id);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed.storedAt !== 'number' ||
      typeof parsed.retrievedAt !== 'string' ||
      !isRecord(parsed.result) ||
      !Array.isArray(parsed.result.warnings) ||
      !Array.isArray(parsed.result.gauges)
    ) {
      return null;
    }
    const entry = parsed as unknown as FeedCacheEntry;
    if (!fresh(entry)) return null;
    memoryCache.set(id, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeCache(id: string, entry: FeedCacheEntry): void {
  memoryCache.set(id, entry);
  try {
    storage()?.setItem(WARNINGS_CACHE_KEY_PREFIX + id, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable: the memory cache still works.
  }
}

function readBackoff(id: string, now: number): { until: number; reason: string } | null {
  const active = (b: { until: number; reason: string } | undefined | null) =>
    b && b.until > now && b.until - now <= WARNINGS_BACKOFF_MS ? b : null;
  const mem = active(memoryBackoff[id]);
  if (mem) return mem;
  try {
    const raw = storage()?.getItem(WARNINGS_BACKOFF_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed) || !isRecord(parsed[id])) return null;
    const b = parsed[id];
    if (typeof b.until !== 'number' || typeof b.reason !== 'string') return null;
    const got = active({ until: b.until, reason: b.reason });
    if (got) memoryBackoff[id] = got;
    return got;
  } catch {
    return null;
  }
}

function writeBackoff(id: string, reason: string, now: number): number {
  const until = now + WARNINGS_BACKOFF_MS;
  memoryBackoff[id] = { until, reason };
  try {
    const s = storage();
    if (s) {
      const raw = s.getItem(WARNINGS_BACKOFF_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      const map = isRecord(parsed) ? parsed : {};
      map[id] = { until, reason };
      s.setItem(WARNINGS_BACKOFF_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore: memory backoff still applies
  }
  return until;
}

function clearBackoff(id: string): void {
  delete memoryBackoff[id];
  try {
    const s = storage();
    const raw = s?.getItem(WARNINGS_BACKOFF_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (s && isRecord(parsed) && id in parsed) {
      delete parsed[id];
      s.setItem(WARNINGS_BACKOFF_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore
  }
}

/** Clear caches, backoffs and the in-flight load (and, unless keepStorage, their sessionStorage entries). */
export function resetWarningsCache(opts?: { keepStorage?: boolean }): void {
  memoryCache.clear();
  memoryBackoff = {};
  inflight = null;
  if (opts?.keepStorage) return;
  try {
    const s = storage();
    if (!s) return;
    for (const spec of SPECS) s.removeItem(WARNINGS_CACHE_KEY_PREFIX + FEEDS[spec.key].id);
    s.removeItem(WARNINGS_BACKOFF_KEY);
  } catch {
    // ignore
  }
}

class HttpFailure extends Error {
  status: number;
  constructor(status: number) {
    super(status === 429 ? 'rate limited' : `HTTP ${status}`);
    this.status = status;
  }
}

/** Readable reason and whether it should start a backoff (429, CORS-less 429 / offline, timeout). */
function classify(err: unknown, timeoutMs: number): { reason: string; transient: boolean } {
  if (err instanceof HttpFailure) return { reason: err.message, transient: err.status === 429 };
  if (err instanceof Error && err.name === 'AbortError') return { reason: `timed out after ${timeoutMs} ms`, transient: true };
  if (err instanceof TypeError) return { reason: 'rate limited or offline', transient: true };
  if (err instanceof Error) return { reason: err.message, transient: false };
  return { reason: String(err), transient: false };
}

function hhmmss(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

interface FeedOutcome {
  status: WarningFeedStatus;
  result: FeedParseResult;
}

function statusOf(spec: FeedSpec, status: WarningFeedStatus['status'], retrievedAt: string | null, message: string | null): WarningFeedStatus {
  const feed = FEEDS[spec.key];
  return { feedId: feed.id, issuer: feed.issuer, issuerUrl: feed.issuerUrl, status, retrievedAt, message };
}

const EMPTY: FeedParseResult = { warnings: [], gauges: [], note: null };

/** Bundled snapshot for one feed, or "unavailable" with the exact required message. */
function fromSnapshot(spec: FeedSpec, reason: string | null, source: WarningsSnapshot | null): FeedOutcome {
  const feed = FEEDS[spec.key];
  const snap = snapshotFeed(feed.id, source);
  if (snap) {
    try {
      const result = spec.parse(snap.raw, { dataMode: 'historical', retrievedAt: snap.retrievedAt as string });
      return {
        status: statusOf(
          spec,
          'snapshot',
          snap.retrievedAt,
          (reason === null
            ? `Bundled snapshot captured ${snap.retrievedAt}; not yet refreshed live. `
            : `Live feed unavailable (${reason}); showing the bundled snapshot captured ${snap.retrievedAt}. `) +
            `Check ${feed.issuer} directly for current messages.`,
        ),
        result,
      };
    } catch {
      // fall through to unavailable
    }
  }
  return { status: statusOf(spec, 'unavailable', null, `Official feed unavailable: check ${feed.issuer} directly`), result: EMPTY };
}

/** Snapshot-only feeds (MAGMA): the parser's note is the status; unavailable when the snapshot has none. */
function fromBundled(spec: FeedSpec, source: WarningsSnapshot | null): FeedOutcome {
  const feed = FEEDS[spec.key];
  const snap = snapshotFeed(feed.id, source);
  if (snap) {
    try {
      const result = spec.parse(snap.raw, { dataMode: 'historical', retrievedAt: snap.retrievedAt as string });
      return { status: statusOf(spec, 'snapshot', snap.retrievedAt, result.note), result };
    } catch {
      // fall through
    }
  }
  return { status: statusOf(spec, 'unavailable', null, `Official feed unavailable: check ${feed.issuer} directly`), result: EMPTY };
}

async function loadFeed(
  spec: FeedSpec,
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number,
  source: WarningsSnapshot | null,
): Promise<FeedOutcome> {
  const feed = FEEDS[spec.key];
  if (!spec.fetchRaw) return fromBundled(spec, source);
  const now = Date.now();
  const cached = readCache(feed.id, now);
  if (cached) return { status: statusOf(spec, 'cached', cached.retrievedAt, cached.result.note), result: cached.result };

  const sharedUntil = spec.dataGovSg ? dataGovSgBackoffUntil(now) : null;
  const backoff = readBackoff(feed.id, now) ?? (sharedUntil ? { until: sharedUntil, reason: 'data.gov.sg rate limited' } : null);
  if (backoff) return fromSnapshot(spec, `${backoff.reason}; retrying live after ${hhmmss(backoff.until)}`, source);
  if (!fetchImpl) return fromSnapshot(spec, 'fetch is not available in this environment', source);

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
    const raw = await spec.fetchRaw(get, now);
    const retrievedAt = nowIso(Date.now());
    const result = spec.parse(raw, { dataMode: 'live', retrievedAt });
    writeCache(feed.id, { storedAt: Date.now(), retrievedAt, result });
    clearBackoff(feed.id);
    return { status: statusOf(spec, 'live', retrievedAt, result.note), result };
  } catch (err) {
    const { reason, transient } = classify(err, timeoutMs);
    let text = reason;
    if (transient) {
      const until = writeBackoff(feed.id, reason, Date.now());
      if (spec.dataGovSg) markDataGovSgRateLimited(reason);
      text = `${reason}; retrying live after ${hhmmss(until)}`;
    }
    return fromSnapshot(spec, text, source);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load every official feed (live first, per-feed timeout), falling back per feed to the bundled real
 * snapshot (HISTORICAL). Never throws. Concurrent calls share one load; live results are reused for
 * 5 minutes; a 429, fetch TypeError or timeout pauses that feed's live fetching for 60 seconds.
 */
export async function loadOfficialWarnings(opts?: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Override the bundled snapshot (null = no snapshot). For tests. */
  snapshot?: WarningsSnapshot | null;
}): Promise<OfficialWarningsResult> {
  if (inflight) return inflight;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const source = opts?.snapshot === undefined ? BUNDLED_WARNINGS_SNAPSHOT : opts.snapshot;
  const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const run = (async (): Promise<OfficialWarningsResult> => {
    const outcomes = await Promise.all(
      SPECS.map(async (spec) => {
        try {
          return await loadFeed(spec, fetchImpl, timeoutMs, source);
        } catch (err) {
          return fromSnapshot(spec, err instanceof Error ? err.message : String(err), source);
        }
      }),
    );
    return {
      warnings: outcomes.flatMap((o) => o.result.warnings).sort(compareWarnings),
      feeds: outcomes.map((o) => o.status),
      gauges: outcomes.flatMap((o) => o.result.gauges).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
  })();
  inflight = run;
  try {
    return await run;
  } catch {
    // Unreachable in practice; keep the never-throw promise.
    return { warnings: [], feeds: SPECS.map((s) => statusOf(s, 'unavailable', null, `Official feed unavailable: check ${FEEDS[s.key].issuer} directly`)), gauges: [] };
  } finally {
    if (inflight === run) inflight = null;
  }
}

/**
 * Every feed parsed from the bundled snapshot only (no network), for offline-first rendering. Tests pass a
 * frozen snapshot so a data refresh never changes their cases.
 */
export function loadWarningsSnapshot(source: WarningsSnapshot = BUNDLED_WARNINGS_SNAPSHOT): OfficialWarningsResult {
  const outcomes = SPECS.map((spec) => (spec.fetchRaw ? fromSnapshot(spec, null, source) : fromBundled(spec, source)));
  return {
    warnings: outcomes.flatMap((o) => o.result.warnings).sort(compareWarnings),
    feeds: outcomes.map((o) => o.status),
    gauges: outcomes.flatMap((o) => o.result.gauges).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
