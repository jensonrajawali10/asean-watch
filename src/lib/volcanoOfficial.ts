// Official information for a watched volcano: the pages to link from the volcano card and the workspace
// (link-outs only; the app never fetches them) and the lookup of its relayed MAGMA level.
// Every URL was opened on 2026-10-14/15 (HTTP 200 with a browser user agent, after redirects).
//
// Ash in the air: the Volcanic Ash Advisory Centres (VAACs) of the ICAO International Airways Volcano Watch.
// - VAAC Darwin (Australian Bureau of Meteorology) covers "the volcanically active regions of Indonesia, Papua
//   New Guinea and the southern Philippines" (its own page): every watched volcano here.
// - VAAC Tokyo (Japan Meteorological Agency) covers Japan, the northern Philippines (e.g. Mayon, Kanlaon) and
//   other parts of East Asia; its advisory list is linked for context.
//
// Why there is no relay of VAAC Darwin advisories (checked 2026-10-14): the advisories page is filled by a
// POST to an internal page endpoint (/aviation/php/process.php) that answers 403 to non-browser clients and
// sends no CORS headers, and the Bureau's anonymous FTP for automated access carries only the graphical
// advisories (IDY652xx.png), not the text. That is not a simple, keyless public feed, so we link instead.
//
// Volcano level and hazard map: PVMBG (Badan Geologi) via MAGMA Indonesia. Per-volcano report pages on MAGMA
// are signed, short-lived URLs, so the card links the public level list and the hazard map (KRB) list, plus
// the watched volcano's own KRB map image as published on that list (map year noted).

import type { OfficialWarning } from '../types';

export interface OfficialVolcanoLink {
  label: string;
  url: string;
  /** Who publishes it. */
  issuer: string;
  /** Short note shown in small text, e.g. "Map published 2010". */
  note?: string;
}

export const VAAC_DARWIN: OfficialVolcanoLink = {
  label: 'VAAC Darwin volcanic ash advisories',
  url: 'https://www.bom.gov.au/aviation/volcanic-ash/darwin-va-advisory.shtml',
  issuer: 'Darwin Volcanic Ash Advisory Centre (Australian Bureau of Meteorology)',
  note: 'Official advisories for ash in the air over Indonesia (aviation)',
};

export const VAAC_DARWIN_HOME: OfficialVolcanoLink = {
  label: 'VAAC Darwin',
  url: 'https://www.bom.gov.au/aviation/volcanic-ash/',
  issuer: 'Darwin Volcanic Ash Advisory Centre (Australian Bureau of Meteorology)',
};

export const VAAC_TOKYO: OfficialVolcanoLink = {
  label: 'VAAC Tokyo volcanic ash advisories',
  url: 'https://www.data.jma.go.jp/vaac/data/vaac_list.html',
  issuer: 'Tokyo Volcanic Ash Advisory Center (Japan Meteorological Agency)',
  note: 'Japan, the northern Philippines and parts of East Asia',
};

export const MAGMA_LEVEL_LIST: OfficialVolcanoLink = {
  label: 'MAGMA Indonesia volcano activity levels',
  url: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
  issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
};

export const MAGMA_KRB_LIST: OfficialVolcanoLink = {
  label: 'MAGMA Indonesia hazard maps (KRB)',
  url: 'https://magma.esdm.go.id/v1/gunung-api/peta-kawasan-rawan-bencana',
  issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
  note: 'Peta Kawasan Rawan Bencana: the official volcanic hazard zone maps',
};

/** Watched volcano (GVP id) -> its KRB map image on MAGMA's hazard map list (the 0.5 MB rendition). */
export const MAGMA_KRB_MAP: Readonly<Record<string, OfficialVolcanoLink>> = {
  'gvp-263250': {
    label: 'Merapi hazard map (KRB)',
    url: 'https://magma.esdm.go.id/storage/krb-gunungapi/large/bno2urlVicsKdLgjG6WWQYMKCxAc4OuyBink8vLX.jpg',
    issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
    note: 'Map published 2010',
  },
  'gvp-263300': {
    label: 'Semeru hazard map (KRB)',
    url: 'https://magma.esdm.go.id/storage/krb-gunungapi/large/jw2AA7ojDiuY8NddQuGaJgz3OoL9lYoff8qH5Vxb.jpg',
    issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
    note: 'Map published 2021',
  },
  'gvp-261080': {
    label: 'Sinabung hazard map (KRB)',
    url: 'https://magma.esdm.go.id/storage/krb-gunungapi/large/8VAVhPXZIctSkU9pL14T8BdXKjeQXhMsqobsNz34.jpg',
    issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
    note: 'Map published 2015',
  },
  'gvp-262000': {
    label: 'Anak Krakatau hazard map (KRB)',
    url: 'https://magma.esdm.go.id/storage/krb-gunungapi/large/gZcXl6jpyIKxuoUy5sNLEO2pGFXv3HHMHqNacuKw.jpg',
    issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
    note: 'Map published 2007',
  },
};

export interface VolcanoOfficialLinks {
  /** The agency's hazard map for this volcano when known, else MAGMA's hazard map list. */
  hazardMap: OfficialVolcanoLink;
  /** MAGMA's hazard map list (always). */
  hazardMapList: OfficialVolcanoLink;
  level: OfficialVolcanoLink;
  /** VAAC for ash in the air over this volcano. */
  vaac: OfficialVolcanoLink;
  /** Everything above in display order, without duplicates. */
  all: OfficialVolcanoLink[];
}

/** Official links for a watched volcano (Indonesian volcanoes: MAGMA and VAAC Darwin). */
export function volcanoOfficialLinks(volcanoId: string | null | undefined): VolcanoOfficialLinks {
  const map = (volcanoId && MAGMA_KRB_MAP[volcanoId]) || null;
  const hazardMap = map ?? MAGMA_KRB_LIST;
  const all = [MAGMA_LEVEL_LIST, hazardMap, ...(map ? [MAGMA_KRB_LIST] : []), VAAC_DARWIN];
  return { hazardMap, hazardMapList: MAGMA_KRB_LIST, level: MAGMA_LEVEL_LIST, vaac: VAAC_DARWIN, all };
}

/** English province of each watched volcano's summit (for local time labels; all are WIB, UTC+7). */
export const WATCHED_VOLCANO_PROVINCE: Readonly<Record<string, string>> = {
  'gvp-263250': 'Central Java',
  'gvp-263300': 'East Java',
  'gvp-261080': 'North Sumatra',
  'gvp-262000': 'Lampung',
};

/** MAGMA records come from warnings.ts (feed id "magma-level-list", record ids "magma-level-list:<GVP number>:<time>"). */
const MAGMA_FEED_ID = 'magma-level-list';

/**
 * The relayed MAGMA level record for a watched volcano, matched by GVP number in the record id, then by the
 * verbatim volcano name (e.g. "Anak Krakatau"). Newest first when several are present. Null when none: the UI
 * then says the level is unavailable and links MAGMA, never "no alert".
 */
export function findMagmaLevel(
  warnings: readonly OfficialWarning[] | null | undefined,
  watch: { volcanoId: string | null; title: string },
): OfficialWarning | null {
  if (!warnings || warnings.length === 0) return null;
  const gvp = watch.volcanoId?.replace(/^gvp-/, '') ?? null;
  const title = watch.title.trim().toLowerCase();
  const magma = warnings.filter((w) => w.hazard === 'volcano' && w.id.startsWith(`${MAGMA_FEED_ID}:`));
  const hits = magma.filter((w) => (gvp && w.id.split(':')[1] === gvp) || w.areas.some((a) => a.name.trim().toLowerCase() === title));
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => Date.parse(b.issuedAt ?? b.retrievedAt) - Date.parse(a.issuedAt ?? a.retrievedAt))[0];
}

/** One source line for the workspace (same shape as AnalystSection's SectionSource). */
export interface ScenarioSourceLine {
  label: string;
  url?: string;
  retrievedAt?: string | null;
  mode?: string;
  licence?: string;
}

/** Sources behind the ash scenario and the volcano links, for the Volcanoes section footer. */
export function scenarioSources(ashWind: { sourceUrl: string; retrievedAt: string; dataMode: 'live' | 'historical' } | null | undefined): ScenarioSourceLine[] {
  return [
    {
      label: 'Open-Meteo pressure-level wind forecast at the summits (700, 500, 300 hPa)',
      url: ashWind?.sourceUrl ?? 'https://open-meteo.com/en/docs',
      retrievedAt: ashWind?.retrievedAt ?? null,
      mode: ashWind ? (ashWind.dataMode === 'live' ? 'LIVE · MODELLED' : 'SNAPSHOT · MODELLED') : 'UNAVAILABLE',
      licence: 'CC BY 4.0',
    },
    { label: 'Town coordinates: GeoNames via the Open-Meteo geocoding API', url: 'https://www.geonames.org/', licence: 'CC BY 4.0' },
    { label: MAGMA_LEVEL_LIST.label, url: MAGMA_LEVEL_LIST.url, mode: 'OFFICIAL' },
    { label: MAGMA_KRB_LIST.label, url: MAGMA_KRB_LIST.url, mode: 'OFFICIAL' },
    { label: VAAC_DARWIN.label, url: VAAC_DARWIN.url, mode: 'OFFICIAL' },
    { label: VAAC_TOKYO.label, url: VAAC_TOKYO.url, mode: 'OFFICIAL' },
  ];
}
