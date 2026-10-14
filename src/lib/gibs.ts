// NASA GIBS raster tiles for MapLibre (Web Mercator, EPSG:3857 WMTS REST, GoogleMapsCompatible).
// Config and helpers only: nothing here fetches at runtime. Layer ids, TileMatrixSets, formats and
// time steps were verified live on 2026-10-14 against
//   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
// by scripts/capture-gibs-check.mjs (npm run check:gibs -> data/gibs-snapshot.json), and sample tiles
// returned 200 with CORS "*". Beyond each maxzoom GIBS returns HTTP 400, so MapLibre must overzoom.
//
//  Himawari_AHI_Band13_Clean_Infrared   GoogleMapsCompatible_Level6  image/png   PT10M (02:40 and 14:40
//                                        UTC slots are absent: Himawari housekeeping; requesting them 404s)
//  VIIRS_NOAA20_CorrectedReflectance_TrueColor  GoogleMapsCompatible_Level9  image/jpeg  P1D
//  MODIS_Terra_CorrectedReflectance_TrueColor   GoogleMapsCompatible_Level9  image/jpeg  P1D
import type { GibsRasterLayer } from '../types';

export const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const GIBS_ATTRIBUTION =
  'Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS. NASA data are freely ' +
  'available without restriction (NASA Earth Science Data Policy).';
export const HIMAWARI_ATTRIBUTION = `${GIBS_ATTRIBUTION} Himawari-9 AHI data © Japan Meteorological Agency (JMA).`;

/** Observed GIBS availability lag for Himawari was ~40-60 min (2026-10-14); 60 min keeps tiles present. */
export const HIMAWARI_SAFE_LAG_MIN = 60;

export const GIBS_LAYERS = {
  himawariIr: {
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    title: 'Himawari clean infrared (AHI Band 13, 10.4 µm)',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    ext: 'png',
    maxzoom: 6,
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/Clean_Longwave_Infrared_Window_Band_H.svg',
  },
  viirsTrueColour: {
    layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    title: 'True colour, VIIRS NOAA-20 corrected reflectance',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    ext: 'jpeg',
    maxzoom: 9,
    legendUrl: null,
  },
  modisTrueColour: {
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    title: 'True colour, MODIS Terra corrected reflectance',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    ext: 'jpeg',
    maxzoom: 9,
    legendUrl: null,
  },
} as const;

type LayerKey = keyof typeof GIBS_LAYERS;

/** MapLibre tile template: WMTS REST {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x}. */
export function gibsTileTemplate(key: LayerKey, time: string): string {
  const l = GIBS_LAYERS[key];
  return `${GIBS_BASE}/${l.layer}/default/${time}/${l.tileMatrixSet}/{z}/{y}/{x}.${l.ext}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** True for the Himawari slots GIBS never has (02:40 and 14:40 UTC). */
export function isHimawariGap(ms: number): boolean {
  const d = new Date(ms);
  return d.getUTCMinutes() === 40 && (d.getUTCHours() === 2 || d.getUTCHours() === 14);
}

/**
 * Himawari image time: now minus the safe lag, floored to the 10-minute slot, stepping back over the
 * 02:40 / 14:40 gaps. Returns ISO 8601 UTC "YYYY-MM-DDTHH:MM:00Z" (the WMTS {Time} format).
 */
export function himawariTime(nowMs: number, lagMin: number = HIMAWARI_SAFE_LAG_MIN): string {
  const slot = 10 * 60000;
  let t = Math.floor((nowMs - lagMin * 60000) / slot) * slot;
  if (isHimawariGap(t)) t -= slot;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`;
}

/** The last `count` Himawari slots ending at himawariTime(nowMs), oldest first (for a time scrubber). */
export function himawariTimes(nowMs: number, count: number, lagMin: number = HIMAWARI_SAFE_LAG_MIN): string[] {
  const out: string[] = [];
  let t = Date.parse(himawariTime(nowMs, lagMin));
  while (out.length < Math.max(0, count)) {
    if (!isHimawariGap(t)) out.unshift(himawariTime(t, 0));
    t -= 10 * 60000;
  }
  return out;
}

/** Yesterday's UTC date (YYYY-MM-DD): the latest day whose daily true-colour mosaic is complete. */
export function yesterdayUtc(nowMs: number): string {
  return new Date(nowMs - 86400000).toISOString().slice(0, 10);
}

export function himawariIrLayer(nowMs: number, time: string = himawariTime(nowMs)): GibsRasterLayer {
  const l = GIBS_LAYERS.himawariIr;
  return {
    id: 'gibs-himawari-ir',
    layer: l.layer,
    title: l.title,
    tiles: [gibsTileTemplate('himawariIr', time)],
    tileSize: 256,
    maxzoom: l.maxzoom,
    attribution: HIMAWARI_ATTRIBUTION,
    timeISO: time,
    latencyNote:
      `Satellite image for ${time.slice(11, 16)} UTC (10-minute scans; requested ${HIMAWARI_SAFE_LAG_MIN} min behind ` +
      'real time because GIBS publishes Himawari about 40-60 min late). Cloud-top brightness temperature; ' +
      'not a rain, haze or ash product.',
    legendUrl: l.legendUrl,
    dataMode: 'live',
  };
}

export function trueColourLayer(nowMs: number, sensor: 'viirs' | 'modis' = 'viirs', date: string = yesterdayUtc(nowMs)): GibsRasterLayer {
  const key = sensor === 'viirs' ? 'viirsTrueColour' : 'modisTrueColour';
  const l = GIBS_LAYERS[key];
  return {
    id: `gibs-${sensor}-truecolour`,
    layer: l.layer,
    title: l.title,
    tiles: [gibsTileTemplate(key, date)],
    tileSize: 256,
    maxzoom: l.maxzoom,
    attribution: GIBS_ATTRIBUTION,
    timeISO: date,
    latencyNote:
      `Daily mosaic for ${date} (UTC day), from polar-orbit passes (${sensor === 'viirs' ? 'about 13:30' : 'about 10:30'} ` +
      'local solar time); swath gaps ' +
      'near the equator are normal. Smoke and haze may be visible; this is imagery, not a measurement.',
    legendUrl: l.legendUrl,
    dataMode: 'live',
  };
}
