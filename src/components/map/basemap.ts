// Basemap per theme, plus a small, defensive style tweak for the light map so overlays pop.
//
// DARK: CARTO Dark Matter, unchanged.
// LIGHT: CARTO Positron GL. Compared on 2026-10-15 against OpenFreeMap positron (the previous light map)
// and OpenFreeMap bright:
//   - Positron (CARTO) labels are muted blue-grey (#697b89 places, #8a99a4 countries), so they sit under
//     the haze, fires and particles instead of competing with them. OpenFreeMap positron prints place
//     and country names in black (#000) from zoom 3, the loudest thing on the map after the overlays.
//   - OpenFreeMap bright draws roads in yellow and orange (#fea, #fc8, #e9ac77) and parks in green: the
//     same hues as the fire ramp and the PM2.5 bands. Rejected for an overlay-first map.
//   - CARTO Positron uses the same vector tiles, source id ("carto") and layer set as Dark Matter, so the
//     theme toggle changes colours only: the same places are labelled at the same zooms, and the 3D
//     building extrusion MapView adds (source "carto", source-layer "building", render_height) works on
//     both themes with no code change.
//   - Licence: the same CARTO basemap terms as the Dark Matter style already in use (attribution
//     "© CARTO, © OpenStreetMap contributors", carried by the style's source), so nothing new to agree to.
// Positron's one weakness for this map is a pale sea (#d4dadc, 1.4:1 against #fafaf8 land): islands
// dissolve at the regional zoom. transformStyle deepens it a little and quiets a few minor layers.
import type { LayerSpecification, StyleSpecification, StyleSwapOptions } from 'maplibre-gl';
import type { MapTheme } from './mapPalette';
import { getMapPalette } from './mapPalette';

export type { MapTheme } from './mapPalette';

export const BASEMAP_URLS: Readonly<Record<MapTheme, string>> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

/** Vector sources that carry an OpenMapTiles-style building layer (render_height), on any basemap here. */
export const BASEMAP_BUILDING_SOURCES: readonly string[] = ['carto', 'openmaptiles'];

/** Style URL for a theme (MapLibre fetches it). */
export function basemapStyleFor(theme: MapTheme): string {
  return BASEMAP_URLS[theme === 'light' ? 'light' : 'dark'];
}

/** fill-extrusion paint for 3D buildings on this theme's basemap. */
export function buildingPaint(theme: MapTheme): { color: string; opacity: number } {
  return getMapPalette(theme).basemap.buildings;
}

// Light tweaks, matched by source-layer and layer type (the OpenMapTiles schema), never by layer id, so
// they keep working if CARTO renames layers. Each one is a plain paint or zoom change.
const LIGHT_WATER = '#c8d3d9'; // 1.5:1 against the #fafaf8 land; matches mapPalette's light `basemap.water`
const LIGHT_WATERWAY = '#b9c7cf';
const LIGHT_COUNTRY_BORDER = '#b8b6b0'; // neutral grey instead of Positron's pink (#ebd6d8): no red cue on the map
const LIGHT_STATE_BORDER = '#d6d3cc';
/** Minor place classes pushed one zoom later, so the haze city labels own zooms 6–10. */
const LATER_PLACE_CLASSES = ['village', 'hamlet', 'suburb', 'neighbourhood', 'isolated_dwelling'];

function mentionsAny(filter: unknown, words: readonly string[]): boolean {
  const s = JSON.stringify(filter ?? null);
  return words.some((w) => s.includes(`"${w}"`));
}

function tweakLightLayer(layer: LayerSpecification): LayerSpecification {
  const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
  if (layer.type === 'fill' && sourceLayer === 'water') {
    // Leave transparent helper fills (Positron's "water_shadow") alone.
    if (layer.paint?.['fill-color'] === 'transparent') return layer;
    return { ...layer, paint: { ...layer.paint, 'fill-color': LIGHT_WATER } };
  }
  if (layer.type === 'line' && sourceLayer === 'waterway') {
    return { ...layer, paint: { ...layer.paint, 'line-color': LIGHT_WATERWAY } };
  }
  if (layer.type === 'line' && sourceLayer === 'boundary') {
    // Leave wide soft casings (Positron's 8 px country "outline" glow) alone; recolour the thin lines.
    const width = layer.paint?.['line-width'];
    if (typeof width === 'number' && width > 3) return layer;
    const country = /"admin_level",2\]/.test(JSON.stringify(layer.filter ?? null));
    return { ...layer, paint: { ...layer.paint, 'line-color': country ? LIGHT_COUNTRY_BORDER : LIGHT_STATE_BORDER } };
  }
  if (layer.type === 'symbol' && sourceLayer === 'place' && mentionsAny(layer.filter, LATER_PLACE_CLASSES)) {
    return { ...layer, minzoom: Math.min(24, (layer.minzoom ?? 0) + 1) };
  }
  if (layer.type === 'symbol' && sourceLayer === 'poi') {
    return { ...layer, minzoom: Math.max(16, layer.minzoom ?? 0) };
  }
  return layer;
}

/**
 * Adjust a fetched basemap style for a theme. Dark returns the style unchanged. Light deepens the sea,
 * neutralises border colours and thins minor labels. Pure: returns a new style and never mutates `style`.
 * Throws only on a malformed style; use `safeTransformStyle` (or `basemapStyleOptions`) in the app.
 */
export function transformStyle(style: StyleSpecification, theme: MapTheme): StyleSpecification {
  if (theme !== 'light') return style;
  if (!style || !Array.isArray(style.layers)) throw new Error('basemap style has no layers');
  return { ...style, layers: style.layers.map(tweakLightLayer) };
}

/** transformStyle that never throws: any error returns the style exactly as fetched. */
export function safeTransformStyle(style: StyleSpecification, theme: MapTheme): StyleSpecification {
  try {
    const out = transformStyle(style, theme);
    return out && Array.isArray(out.layers) && out.layers.length === style.layers.length ? out : style;
  } catch {
    return style;
  }
}

/**
 * Options for `map.setStyle(basemapStyleFor(theme), basemapStyleOptions(theme))`: a full (non-diff) swap,
 * with MapLibre's transformStyle hook applying the light tweaks after the fetch. On any error in the
 * tweak the style is used exactly as fetched; fetch errors still reach the map's 'error' event as before.
 */
export function basemapStyleOptions(theme: MapTheme): StyleSwapOptions {
  return { diff: false, transformStyle: (_previous, next) => safeTransformStyle(next, theme) };
}
