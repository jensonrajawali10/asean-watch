// Plain-language helpers for the map popovers: per-place UTC offsets (local time labels) and the national
// services a viewer should check for the official word. Pure, no DOM; tested in places.test.ts.
//
// None of these countries observes daylight saving time, so a fixed offset per place is exact. Indonesia has
// three zones by province: WIB (UTC+7), WITA (UTC+8) and WIT (UTC+9).

/** Indonesian provinces (English names) to UTC offset in hours: WIB +7, WITA +8, WIT +9. */
export const ID_PROVINCE_UTC_OFFSET: Readonly<Record<string, 7 | 8 | 9>> = {
  // WIB (UTC+7): Sumatra, Java, West and Central Kalimantan
  Aceh: 7,
  'North Sumatra': 7,
  'West Sumatra': 7,
  Riau: 7,
  'Riau Islands': 7,
  Jambi: 7,
  'South Sumatra': 7,
  'Bangka Belitung Islands': 7,
  Bengkulu: 7,
  Lampung: 7,
  Jakarta: 7,
  Banten: 7,
  'West Java': 7,
  'Central Java': 7,
  Yogyakarta: 7,
  'East Java': 7,
  'West Kalimantan': 7,
  'Central Kalimantan': 7,
  // WITA (UTC+8): Bali, Nusa Tenggara, South/East/North Kalimantan, Sulawesi
  Bali: 8,
  'West Nusa Tenggara': 8,
  'East Nusa Tenggara': 8,
  'South Kalimantan': 8,
  'East Kalimantan': 8,
  'North Kalimantan': 8,
  'North Sulawesi': 8,
  Gorontalo: 8,
  'Central Sulawesi': 8,
  'West Sulawesi': 8,
  'South Sulawesi': 8,
  'Southeast Sulawesi': 8,
  // WIT (UTC+9): Maluku and Papua
  Maluku: 9,
  'North Maluku': 9,
  Papua: 9,
  'West Papua': 9,
  'Southwest Papua': 9,
  'Central Papua': 9,
  'Highland Papua': 9,
  'South Papua': 9,
};

/** Single-zone countries (ISO 3166-1 alpha-2) to UTC offset in hours. Indonesia goes by province instead. */
export const COUNTRY_UTC_OFFSET: Readonly<Record<string, number>> = {
  MY: 8,
  SG: 8,
  TH: 7,
  VN: 7,
  KH: 7,
  PH: 8,
  BN: 8,
  LA: 7,
  MM: 6.5,
  TL: 9,
  JP: 9,
  TW: 8,
  HK: 8,
  CN: 8,
};

/** IOC sea-level country codes to ISO alpha-2 (only the ones the popovers use). */
export const IOC_TO_ISO: Readonly<Record<string, string>> = {
  IDN: 'ID',
  FIL: 'PH',
  THA: 'TH',
  MLS: 'MY',
  SGP: 'SG',
  VNM: 'VN',
  JPN: 'JP',
  JAP: 'JP',
  MYA: 'MM',
  TWN: 'TW',
  HKG: 'HK',
  CHN: 'CN',
};

/** Province of each Indonesian place the map names (air-quality places and river points), by id. */
export const PLACE_PROVINCE: Readonly<Record<string, string>> = {
  pekanbaru: 'Riau',
  dumai: 'Riau',
  jambi: 'Jambi',
  palembang: 'South Sumatra',
  'kayu-agung': 'South Sumatra',
  medan: 'North Sumatra',
  jakarta: 'Jakarta',
  'ciliwung-jakarta': 'Jakarta',
  pontianak: 'West Kalimantan',
  ketapang: 'West Kalimantan',
  'palangka-raya': 'Central Kalimantan',
  'pulang-pisau': 'Central Kalimantan',
};

/** Province of each Indonesian IOC tide gauge in the bundled station list, by IOC code. */
export const IDN_TIDE_GAUGE_PROVINCE: Readonly<Record<string, string>> = {
  ambon: 'Maluku',
  beno: 'Bali',
  bitu: 'North Sulawesi',
  bupo: 'West Sumatra',
  cili: 'Central Java',
  engg: 'Bengkulu',
  koli: 'Jakarta',
  koli2: 'Jakarta',
  lemba: 'West Nusa Tenggara',
  maju: 'Banten',
  meul: 'Aceh',
  meul2: 'Aceh',
  pada: 'West Sumatra',
  padn: 'West Sumatra',
  pana: 'West Java',
  pand: 'West Java',
  prig: 'East Java',
  rote: 'East Nusa Tenggara',
  saba: 'Aceh',
  sade: 'Yogyakarta',
  sadp: 'Yogyakarta',
  saum: 'Maluku',
  sebe: 'Lampung',
  sema: 'Central Java',
  sibo: 'North Sumatra',
  sura: 'East Java',
  telu: 'North Sumatra',
  tjls: 'Banten',
  tnbl: 'North Sumatra',
  waik: 'East Nusa Tenggara',
};

export interface PlaceRef {
  /** ISO 3166-1 alpha-2, e.g. "ID". */
  country: string;
  /** English province name; needed for Indonesia. */
  province?: string | null;
}

/** A named place (air-quality place or river point) by id and ISO country. */
export function placeRef(p: { id: string; country: string }): PlaceRef {
  return { country: p.country, province: PLACE_PROVINCE[p.id] ?? null };
}

/** An IOC tide gauge by IOC code and IOC country code. */
export function tideGaugeRef(st: { code: string; country: string }): PlaceRef {
  const country = IOC_TO_ISO[st.country] ?? st.country;
  return { country, province: country === 'ID' ? (IDN_TIDE_GAUGE_PROVINCE[st.code] ?? null) : null };
}

/** UTC offset in hours, or null when unknown (an Indonesian place without a known province, or another country). */
export function utcOffsetHours(place: PlaceRef | null | undefined): number | null {
  if (!place) return null;
  if (place.country === 'ID') return place.province ? (ID_PROVINCE_UTC_OFFSET[place.province] ?? null) : null;
  return COUNTRY_UTC_OFFSET[place.country] ?? null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function clock12(d: Date): string {
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getUTCMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Fri 16 Oct" for a Date read in UTC fields. */
function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 16 Oct" for a YYYY-MM-DD calendar day (no time-zone shift). */
export function calendarDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : dayLabel(d);
}

export interface LocalTimeOptions {
  /** Include the weekday and date (default true). */
  day?: boolean;
  /** Append "(10:00 UTC)" after the local time (default true). */
  utc?: boolean;
}

/**
 * "Fri 16 Oct, 5:00 pm local (10:00 UTC)" for a place with a known offset; "Fri 16 Oct, 10:00 UTC" when the
 * offset is unknown (never a guessed local time). Weekdays are computed, never hard-coded.
 */
export function localTimeLabel(iso: string, place: PlaceRef | null | undefined, opts: LocalTimeOptions = {}): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const withDay = opts.day ?? true;
  const withUtc = opts.utc ?? true;
  const u = new Date(ms);
  const utcClock = `${pad2(u.getUTCHours())}:${pad2(u.getUTCMinutes())} UTC`;
  const offset = utcOffsetHours(place);
  if (offset === null) return withDay ? `${dayLabel(u)}, ${utcClock}` : utcClock;
  const l = new Date(ms + offset * 3_600_000);
  const local = `${clock12(l)} local`;
  return `${withDay ? `${dayLabel(l)}, ` : ''}${local}${withUtc ? ` (${utcClock})` : ''}`;
}

// ---------------------------------------------------------------------------
// Where the official word comes from. Every URL below was opened live on 2026-10-14 (HTTP 200 after
// redirects). Countries without a verified service get no link; the popover then names the kind of agency.

export interface OfficialLink {
  /** Link text, e.g. "BMKG InaTEWS". */
  label: string;
  url: string;
}

/** National air-quality services (official readings and advice), by ISO country. */
export const AIR_QUALITY_OFFICIAL: Readonly<Record<string, OfficialLink>> = {
  // ISPU moved from ispu.menlhk.go.id (no longer resolves) to the Ministry of Environment's domain.
  ID: { label: 'ISPU, Ministry of Environment (KLH)', url: 'https://ispu.kemenlh.go.id/' },
  // apims.doe.gov.my now redirects (301) to DOE's MyEQMS portal, which carries the API readings.
  MY: { label: 'APIMS, Department of Environment (DOE)', url: 'https://eqms.doe.gov.my/' },
  SG: { label: 'NEA haze updates', url: 'https://www.haze.gov.sg/' },
  // Checked 2026-10-20: env.gov.bn resolves (HTTP 200) and posts "PSI Reading update for Brunei Darussalam".
  BN: { label: 'PSI readings, JASTRe (Department of Environment, Parks and Recreation)', url: 'https://www.env.gov.bn/' },
  // Checked 2026-10-20: cem.gov.vn resolves (HTTP 200) but shows automated clients a validation page; it is
  // the Ministry of Agriculture and Environment's monitoring centre, which publishes VN_AQI.
  VN: { label: 'VN_AQI, Centre for Environmental Monitoring (CEM)', url: 'https://cem.gov.vn/' },
  // KH, LA, MM, TL: no official air-quality page could be verified on 2026-10-20, so no link (the card
  // names the kind of agency instead of guessing a URL).
  TH: { label: 'Air4Thai, Pollution Control Department (PCD)', url: 'https://air4thai.pcd.go.th/webV3/' },
  PH: { label: 'EMB air quality', url: 'https://air.emb.gov.ph/' },
};

/**
 * The index each country's official service publishes (ISPU, API, PSI...), by ISO country. Only the ones
 * seen on the official service; absent means not verified. This map fetches only Singapore's PSI (NEA).
 */
export const AIR_QUALITY_INDEX: Readonly<Record<string, string>> = {
  ID: 'ISPU',
  MY: 'API (Air Pollutant Index)',
  SG: 'PSI',
  TH: 'AQI (Thailand)',
  VN: 'VN_AQI',
  BN: 'PSI',
};

/**
 * Why a card shows no PSI, in plain words, or null for Singapore (whose NEA PSI the card shows).
 * PSI is the index Singapore (and Brunei) publish; elsewhere each country has its own, behind its link.
 */
export function noPsiNote(country: string): string | null {
  if (country === 'SG') return null;
  const name = COUNTRY_NAME[country] ?? 'This country';
  const index = AIR_QUALITY_INDEX[country] ?? null;
  const linked = Boolean(AIR_QUALITY_OFFICIAL[country]);
  if (index === 'PSI') return `${name} reports its own PSI${linked ? ' (official link below)' : ''}; this map does not fetch it.`;
  if (index) return `Singapore reports PSI; ${name} reports ${index}${linked ? ' (official link below)' : ''}.`;
  return `Singapore reports PSI; we found no official air-quality page for ${name}.`;
}

/** National tsunami warning services, by ISO country. */
export const TSUNAMI_OFFICIAL: Readonly<Record<string, OfficialLink>> = {
  ID: { label: 'BMKG InaTEWS', url: 'https://inatews.bmkg.go.id/' },
  PH: { label: 'PHIVOLCS', url: 'https://www.phivolcs.dost.gov.ph/' },
  TH: { label: 'Thai Meteorological Department (TMD)', url: 'https://www.tmd.go.th/' },
  MY: { label: 'MetMalaysia', url: 'https://www.met.gov.my/' },
  JP: { label: 'Japan Meteorological Agency (JMA)', url: 'https://www.jma.go.jp/bosai/map.html#contents=tsunami' },
};

/** Official river and flood services for the modelled river points, by ISO country. */
export const FLOOD_OFFICIAL: Readonly<Record<string, OfficialLink>> = {
  // Cambodia's water ministry site (mowram.gov.kh) did not resolve; the Mekong River Commission's flood centre did.
  KH: { label: 'Mekong River Commission flood forecasts', url: 'https://ffw.mrcmekong.org/' },
  TH: { label: 'ThaiWater, National Hydroinformatics Data Center', url: 'https://www.thaiwater.net/' },
  ID: { label: 'Posko Banjir, DSDA Jakarta', url: 'https://poskobanjir.dsdadki.web.id/' },
  MY: { label: 'Public Infobanjir (JPS)', url: 'https://publicinfobanjir.water.gov.my/' },
};

/** Country display names for the generic "check <country>'s agency" fallback. */
export const COUNTRY_NAME: Readonly<Record<string, string>> = {
  ID: 'Indonesia',
  MY: 'Malaysia',
  SG: 'Singapore',
  TH: 'Thailand',
  VN: 'Vietnam',
  KH: 'Cambodia',
  PH: 'the Philippines',
  JP: 'Japan',
  BN: 'Brunei',
  MM: 'Myanmar',
  LA: 'Laos',
  TL: 'Timor-Leste',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  CN: 'China',
};
