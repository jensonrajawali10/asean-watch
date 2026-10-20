// Modelled air quality for a fire region (province, state or country) or a fire cluster, for the map's
// fire cards. Pure. The value is CAMS PM2.5 (MODELLED, ~45 km squares) at a stated point, never a
// measurement and never an official index:
// 1. the region's main air-quality place (a province's city, a country's capital), when there is one;
// 2. else the model grid at the fires' FRP-weighted centre, when that is inside the grid;
// 3. else nothing, with the reason in plain words.
import { AQ_PLACES, pm25At, placePm25At } from './airQuality';
import type { AirQualityData, AqPlaceSeries } from './airQuality';
import { PLACE_PROVINCE } from './places';

/** Malaysian states with an air-quality place, by place id (Indonesian provinces come from PLACE_PROVINCE). */
const MY_PLACE_STATE: Readonly<Record<string, string>> = {
  kuching: 'Sarawak',
  ipoh: 'Perak',
  'george-town': 'Penang',
};

/** Country (ISO 3166-1 alpha-3, as in the fires snapshot) to its capital's air-quality place id. */
export const COUNTRY_CAPITAL_PLACE: Readonly<Record<string, string>> = {
  IDN: 'jakarta',
  MYS: 'kuala-lumpur',
  SGP: 'singapore',
  THA: 'bangkok',
  VNM: 'hanoi',
  KHM: 'phnom-penh',
  PHL: 'manila',
  BRN: 'bandar-seri-begawan',
  LAO: 'vientiane',
  MMR: 'naypyidaw',
  TLS: 'dili',
};

export type AreaAir =
  | { kind: 'place'; place: AqPlaceSeries; value: number; where: string }
  | { kind: 'grid'; lat: number; lon: number; value: number; where: string }
  | { kind: 'none'; reason: string };

export interface AreaAirInput {
  /** "IDN:Riau", "MYS:Sarawak", or an ISO3 country ("IDN") for a country rollup. */
  key: string;
  name: string;
  /** Where the fires are (FRP-weighted centre), [lat, lon]; null when unknown. */
  centre: readonly [number, number] | null;
}

const clean = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

/** The air-quality place that stands for a fire region, or null. City first, then a fire-area town. */
export function areaPlaceId(key: string): { id: string; role: string } | null {
  const [iso3, region] = key.includes(':') ? key.split(':', 2) : [key, null];
  if (region === null) {
    const id = COUNTRY_CAPITAL_PLACE[iso3];
    return id ? { id, role: 'the capital' } : null;
  }
  const inRegion = (id: string) => (iso3 === 'IDN' ? PLACE_PROVINCE[id] : iso3 === 'MYS' ? MY_PLACE_STATE[id] : undefined) === region;
  const city = AQ_PLACES.find((p) => p.kind === 'city' && inRegion(p.id));
  if (city) return { id: city.id, role: iso3 === 'MYS' ? 'a main city of the state' : 'a main city of the province' };
  const town = AQ_PLACES.find((p) => p.kind === 'fire-area' && inRegion(p.id));
  return town ? { id: town.id, role: 'a fire-prone town in the province' } : null;
}

/** Modelled PM2.5 for a fire region or cluster at timeISO (see the module comment for the order). */
export function areaAir(data: AirQualityData | null, area: AreaAirInput, timeISO: string): AreaAir {
  if (!data) return { kind: 'none', reason: 'The air-quality model has not loaded yet.' };
  const pick = areaPlaceId(area.key);
  const place = pick ? (data.places.find((p) => p.id === pick.id) ?? null) : null;
  if (place && pick) {
    const value = placePm25At(data, place, timeISO);
    if (Number.isFinite(value)) return { kind: 'place', place, value, where: `at ${clean(place.name)}, ${pick.role}` };
  }
  if (area.centre) {
    const [lat, lon] = area.centre;
    const value = pm25At(data, lat, lon, timeISO);
    if (Number.isFinite(value)) return { kind: 'grid', lat, lon, value, where: 'at the centre of the fires here' };
  }
  return {
    kind: 'none',
    reason: `No modelled air-quality point for ${area.name}: the haze model on this map covers about 6°S to 8°N, 95°E to 120°E, plus the named cities.`,
  };
}

/** ISO 3166-1 alpha-3 (fires snapshot) to alpha-2 (places.ts), for the countries the cards link. */
export const ISO3_TO_ISO2: Readonly<Record<string, string>> = {
  IDN: 'ID',
  MYS: 'MY',
  SGP: 'SG',
  THA: 'TH',
  VNM: 'VN',
  KHM: 'KH',
  PHL: 'PH',
  BRN: 'BN',
  LAO: 'LA',
  MMR: 'MM',
  TLS: 'TL',
};
