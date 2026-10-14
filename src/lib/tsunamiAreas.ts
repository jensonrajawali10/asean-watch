// Places BMKG InaTEWS tsunami warning areas (<wzarea> district names, relayed verbatim) at Indonesian
// regency/city centre points from geoBoundaries (data/idn-adm2-centroids.json, CC BY 3.0 IGO).
// Pure and deterministic. Positions are APPROXIMATE (a district centre, never a boundary or an
// inundation zone). An area that cannot be matched with confidence is never dropped and never guessed:
// it is returned in `unplaced` with the reason, for the panel's "Not placed on map" list.
//
// Matching rules:
// - Case-insensitive; "KAB."/"KABUPATEN" is stripped; a leading "KOTA" (e.g. "KOTA-BAU-BAU") marks a
//   city and is matched only against geoBoundaries "Kota ..." names.
// - Spaces, hyphens and dots are ignored ("BOLAANGMONGONDOW" = "Bolaang Mongondow", "TOLI-TOLI" = "Toli-Toli").
// - Without "KOTA" the regency (kabupaten) of that name is preferred; the city is used only when no
//   regency has the name (Indonesian convention: an unqualified name is the regency).
// - "<district> BAGIAN UTARA/SELATAN/BARAT/TIMUR/TENGAH" is a coastal segment of the base district: it is
//   placed at the base district's centre, offset SEGMENT_OFFSET_KM in that compass direction (TENGAH: no
//   offset), and labelled approximate.
// - A geoBoundaries name whose only difference is the word "Kepulauan" (e.g. "Kepulauan Selayar",
//   "Kota Tidore Kepulauan") also matches, but only when no exact name does.
// - Two or more equally good candidates: not placed ("ambiguous"). No candidate: not placed.
import type { OfficialWarning, OfficialWarningArea } from '../types';
import centroidsJson from '../../data/idn-adm2-centroids.json';

export interface DistrictCentre {
  /** geoBoundaries shapeName, e.g. "Manggarai Barat", "Kota Baubau". */
  name: string;
  lat: number;
  lon: number;
}

export interface DistrictCentres {
  districts: DistrictCentre[];
  source: string;
  sourceUrl: string;
  licence: string;
  attribution: string;
  retrievedAt: string;
}

export type CoastalSegment = 'UTARA' | 'SELATAN' | 'BARAT' | 'TIMUR' | 'TENGAH';

export interface ParsedAreaName {
  /** Upper-case base district name without KAB./KOTA and segment, e.g. "MANGGARAI-BARAT". */
  base: string;
  /** Comparison key: base with spaces, hyphens and dots removed. */
  key: string;
  city: boolean;
  segment: CoastalSegment | null;
}

export interface PlacedArea {
  /** The BMKG area exactly as relayed (verbatim name, level, province). */
  area: OfficialWarningArea;
  /** The geoBoundaries district it was matched to. */
  district: string;
  lat: number;
  lon: number;
  segment: CoastalSegment | null;
  /** Always true: a district centre (or offset centre) is an approximation of the warned coast. */
  approximate: true;
  /** Plain-English placement note, e.g. "North coast segment of Manggarai, placed 15 km north of its centre (approximate)". */
  note: string;
}

export interface UnplacedArea {
  area: OfficialWarningArea;
  reason: string;
}

export interface TsunamiAreaPlacement {
  placed: PlacedArea[];
  unplaced: UnplacedArea[];
}

/** Distance a BAGIAN UTARA/SELATAN/BARAT/TIMUR segment is moved from the district centre. */
export const SEGMENT_OFFSET_KM = 15;

const SEGMENT_BEARING: Record<CoastalSegment, number | null> = { UTARA: 0, TIMUR: 90, SELATAN: 180, BARAT: 270, TENGAH: null };
const SEGMENT_WORD: Record<CoastalSegment, string> = { UTARA: 'North', TIMUR: 'East', SELATAN: 'South', BARAT: 'West', TENGAH: 'Central' };
const SEGMENT_DIR: Record<CoastalSegment, string> = { UTARA: 'north', TIMUR: 'east', SELATAN: 'south', BARAT: 'west', TENGAH: '' };

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function parseAreaName(name: string): ParsedAreaName {
  let s = name.toUpperCase().replace(/\s+/g, ' ').trim();
  let segment: CoastalSegment | null = null;
  const seg = /\s+BAGIAN\s+(UTARA|SELATAN|BARAT|TIMUR|TENGAH)$/.exec(s);
  if (seg) {
    segment = seg[1] as CoastalSegment;
    s = s.slice(0, seg.index).trim();
  }
  s = s.replace(/^KAB(?:UPATEN)?\.?[\s-]+/, '');
  let city = false;
  const kota = /^KOTA(?:\.|\s|-)+/.exec(s);
  if (kota) {
    city = true;
    s = s.slice(kota[0].length);
  }
  return { base: s, key: compact(s), city, segment };
}

interface IndexEntry {
  district: DistrictCentre;
  city: boolean;
}

export interface DistrictIndex {
  exact: Map<string, IndexEntry[]>;
  alias: Map<string, IndexEntry[]>;
}

export function buildDistrictIndex(districts: readonly DistrictCentre[]): DistrictIndex {
  const exact = new Map<string, IndexEntry[]>();
  const alias = new Map<string, IndexEntry[]>();
  const add = (m: Map<string, IndexEntry[]>, k: string, e: IndexEntry) => {
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };
  for (const d of districts) {
    if (!d || typeof d.name !== 'string' || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) continue;
    const kota = /^Kota\s+/i.exec(d.name.trim());
    const base = kota ? d.name.trim().slice(kota[0].length) : d.name.trim();
    const e: IndexEntry = { district: d, city: Boolean(kota) };
    add(exact, compact(base), e);
    const noKep = compact(base.replace(/\bKepulauan\b/gi, ''));
    if (noKep !== compact(base)) add(alias, noKep, e);
  }
  return { exact, alias };
}

/** Destination point (spherical earth) `km` along `bearingDeg` from lat/lon. */
export function offsetPoint(lat: number, lon: number, bearingDeg: number, km: number): { lat: number; lon: number } {
  const R = 6371.0088;
  const d = km / R;
  const b = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}

function pick(entries: IndexEntry[] | undefined, city: boolean): IndexEntry[] {
  if (!entries || entries.length === 0) return [];
  if (city) return entries.filter((e) => e.city);
  const regencies = entries.filter((e) => !e.city);
  return regencies.length > 0 ? regencies : entries.filter((e) => e.city);
}

export function placeTsunamiAreas(areas: readonly OfficialWarningArea[], index: DistrictIndex): TsunamiAreaPlacement {
  const placed: PlacedArea[] = [];
  const unplaced: UnplacedArea[] = [];
  for (const area of areas) {
    const name = typeof area?.name === 'string' ? area.name : '';
    const parsed = parseAreaName(name);
    if (!parsed.key) {
      unplaced.push({ area, reason: 'No district name given' });
      continue;
    }
    let found = pick(index.exact.get(parsed.key), parsed.city);
    if (found.length === 0) found = pick(index.alias.get(parsed.key), parsed.city);
    const unique = [...new Set(found)];
    if (unique.length === 0) {
      unplaced.push({ area, reason: `No regency or city named "${parsed.base}" in geoBoundaries` });
      continue;
    }
    if (unique.length > 1) {
      unplaced.push({ area, reason: `Ambiguous: matches ${unique.map((e) => e.district.name).join(' and ')}` });
      continue;
    }
    const d = unique[0].district;
    const bearing = parsed.segment ? SEGMENT_BEARING[parsed.segment] : null;
    const at = bearing === null ? { lat: d.lat, lon: d.lon } : offsetPoint(d.lat, d.lon, bearing, SEGMENT_OFFSET_KM);
    const note = parsed.segment
      ? bearing === null
        ? `${SEGMENT_WORD[parsed.segment]} segment of ${d.name}, placed at its district centre (approximate)`
        : `${SEGMENT_WORD[parsed.segment]} coast segment of ${d.name}, placed ${SEGMENT_OFFSET_KM} km ${SEGMENT_DIR[parsed.segment]} of its district centre (approximate)`
      : `District centre of ${d.name} (approximate)`;
    placed.push({ area, district: d.name, lat: at.lat, lon: at.lon, segment: parsed.segment, approximate: true, note });
  }
  return { placed, unplaced };
}

// ---------------------------------------------------------------------------
// Bundled centres and warning selection

function readCentres(raw: unknown): DistrictCentres {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.districts) ? r.districts : [];
  const districts = list.filter(
    (d): d is DistrictCentre =>
      typeof d === 'object' && d !== null && typeof (d as DistrictCentre).name === 'string' && Number.isFinite((d as DistrictCentre).lat) && Number.isFinite((d as DistrictCentre).lon),
  );
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  return { districts, source: s('source'), sourceUrl: s('sourceUrl'), licence: s('licence'), attribution: s('attribution'), retrievedAt: s('retrievedAt') };
}

export const IDN_DISTRICT_CENTRES: DistrictCentres = readCentres(centroidsJson as unknown);
export const GEOBOUNDARIES_ATTRIBUTION = 'District centres: geoBoundaries IDN ADM2 (BPS, WFP, OCHA ROAP), CC BY 3.0 IGO';

let defaultIndex: DistrictIndex | null = null;
export function idnDistrictIndex(): DistrictIndex {
  if (!defaultIndex) defaultIndex = buildDistrictIndex(IDN_DISTRICT_CENTRES.districts);
  return defaultIndex;
}

const isBmkgTsunami = (w: OfficialWarning) =>
  w.authority === 'official' && w.hazard === 'tsunami' && w.id.startsWith('bmkg-inatews:') && Array.isArray(w.areas) && w.areas.length > 0;

const issuedMs = (w: OfficialWarning) => {
  const t = w.issuedAt ? Date.parse(w.issuedAt) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The BMKG InaTEWS message whose areas the map shows: `inForce` is the latest message with areas that
 * BMKG has not ended; `latest` is the latest message with areas whatever its state (for the History switch).
 */
export function selectTsunamiAreaWarnings(warnings: readonly OfficialWarning[] | null | undefined): {
  inForce: OfficialWarning | null;
  latest: OfficialWarning | null;
} {
  const list = (warnings ?? []).filter(isBmkgTsunami).sort((a, b) => issuedMs(b) - issuedMs(a));
  return { inForce: list.find((w) => !w.ended) ?? null, latest: list[0] ?? null };
}
