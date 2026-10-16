// deck.gl layers for the "If it erupted now" ash scenario (src/lib/eruptionScenario.ts). MODELLED SCENARIO:
// soft grey-violet ash per height at the time the caller passes (the map scrubber or the play animation),
// drawn as each height's continuous chain of puffs (densified circles, so a fast wind does not show hourly
// beads), a faint trail along each height's ash front, and the footprint outline. Grey-violet on purpose: red is
// reserved for official warnings, and the cream/tan ash-drift lines and the warm haze stay distinct. Colours
// come from mapPalette.ts (getMapPalette(theme).ash.plume), where every map overlay colour lives.
//
// Overlap: circles are translucent and overlap heavily, so each circle's alpha is set from how many circles of
// its height cover its centre (n): a = 1 - (1 - A)^(1/n). Overlapping circles then add up to about the
// palette's target alpha A instead of turning solid, and the plume's edges stay soft; older ash fades a little.
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { arrivalsBy, footprintAt, frontPathsAt, hoursShort, plumeCirclesAt } from '../../lib/eruptionScenario';
import type { EruptionScenario, LonLat, PlaceArrival, PlumeCircle, Ring } from '../../lib/eruptionScenario';
import type { AshLevel } from '../../lib/ashDrift';
import { getMapPalette } from './mapPalette';
import type { MapTheme, PlumeColours, Rgb as PaletteRgb, Rgba as PaletteRgba } from './mapPalette';

export type PlumeTheme = MapTheme;
export type Rgb = PaletteRgb;
export type Rgba = PaletteRgba;
/** Plume colours: the same type as mapPalette.ts PlumeColours (the one place map colours live). */
export type PlumePalette = PlumeColours;

/**
 * Theme palettes, read from getMapPalette(theme).ash.plume. Dark: pale grey-violet on CARTO Dark Matter.
 * Light: deeper grey-violet on positron.
 */
export const PLUME_COLORS: Readonly<Record<PlumeTheme, PlumePalette>> = {
  dark: getMapPalette('dark').ash.plume,
  light: getMapPalette('light').ash.plume,
};

/** CSS colour strings per height for a legend swatch, e.g. "rgb(184 172 224)". */
export function plumeLegend(theme: PlumeTheme): { level: AshLevel; css: string }[] {
  const p = PLUME_COLORS[theme];
  return (['700', '500', '300'] as const).map((level) => ({ level, css: `rgb(${p.level[level].join(' ')})` }));
}

export interface PlumeLayerOptions {
  theme: PlumeTheme;
  /** Palette override; default PLUME_COLORS[theme] (getMapPalette(theme).ash.plume). */
  palette?: PlumePalette;
  /** Layer id prefix (default "plume"). */
  idPrefix?: string;
  visible?: boolean;
  /** Overall layer opacity (default 1), e.g. to fade the plume in or out. */
  opacity?: number;
  /** Heights to draw (default all three). */
  levels?: readonly AshLevel[];
  /** Ash-front trail lines (default true). */
  showTrail?: boolean;
  /** Footprint outline (default true). */
  showFootprint?: boolean;
  /** Dots and "<town> about 2 h" labels for listed places reached by this time (default false). */
  showPlaces?: boolean;
  /** Make the ash pickable (hover info: PlumeDatum with level and age). Default false. */
  pickable?: boolean;
}

export interface PlumeDatum {
  circle: PlumeCircle;
  position: LonLat;
  radiusM: number;
  color: Rgba;
  halo: Rgba;
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

/** Per-circle fill colours with overlap-normalised alpha and a gentle fade with age. */
export function puffColours(puffs: readonly PlumeCircle[], hoursTotal: number, palette: PlumePalette): { color: Rgba; halo: Rgba }[] {
  const A = Math.min(0.95, Math.max(0.01, palette.puffAlpha));
  return puffs.map((p) => {
    let n = 0;
    const kx = KM_PER_DEG_LON_EQ * Math.cos((p.lat * Math.PI) / 180);
    for (const q of puffs) {
      if (q.level !== p.level) continue;
      const d = Math.hypot((p.lon - q.lon) * kx, (p.lat - q.lat) * KM_PER_DEG_LAT);
      if (d <= q.radiusKm) n += 1;
    }
    const a = 1 - (1 - A) ** (1 / Math.max(1, n));
    const fade = 1 - 0.45 * Math.min(1, p.ageH / Math.max(12, hoursTotal));
    const rgb = palette.level[p.level];
    const alpha = Math.round(255 * a * fade);
    return { color: [rgb[0], rgb[1], rgb[2], alpha], halo: [rgb[0], rgb[1], rgb[2], Math.round(alpha * palette.haloAlpha)] };
  });
}

/**
 * Layers for the scenario at `timeMs` (ms since epoch). Empty before the scenario start or without a
 * scenario; held at the last hour after the end. Order: halo, puffs, trail, footprint, places.
 */
export function buildPlumeLayers(scenario: EruptionScenario | null | undefined, timeMs: number, opts: PlumeLayerOptions): Layer[] {
  if (!scenario || !Number.isFinite(timeMs) || timeMs < scenario.startMs) return [];
  const palette = opts.palette ?? PLUME_COLORS[opts.theme] ?? PLUME_COLORS.dark;
  const id = opts.idPrefix ?? 'plume';
  const visible = opts.visible ?? true;
  const opacity = opts.opacity ?? 1;
  const levelSet = new Set<AshLevel>(opts.levels ?? ['700', '500', '300']);
  const circles = plumeCirclesAt(scenario, timeMs, [...levelSet]);
  // Oldest first so the young, denser ash near the vent draws on top.
  circles.sort((a, b) => b.ageH - a.ageH || a.level.localeCompare(b.level));
  const colours = puffColours(circles, scenario.hours, palette);
  const data: PlumeDatum[] = circles.map((p, i) => ({
    circle: p,
    position: [p.lon, p.lat],
    radiusM: p.radiusKm * 1000,
    color: colours[i].color,
    halo: colours[i].halo,
  }));
  const layers: Layer[] = [
    new ScatterplotLayer<PlumeDatum>({
      id: `${id}-halo`,
      data,
      visible,
      opacity,
      getPosition: (d) => d.position,
      getRadius: (d) => d.radiusM * palette.haloScale,
      radiusUnits: 'meters',
      radiusMinPixels: 2,
      filled: true,
      stroked: false,
      getFillColor: (d) => d.halo,
      pickable: false,
    }),
    new ScatterplotLayer<PlumeDatum>({
      id: `${id}-puffs`,
      data,
      visible,
      opacity,
      getPosition: (d) => d.position,
      getRadius: (d) => d.radiusM,
      radiusUnits: 'meters',
      radiusMinPixels: 1.5,
      filled: true,
      stroked: false,
      getFillColor: (d) => d.color,
      pickable: opts.pickable ?? false,
    }),
  ];
  if (opts.showTrail ?? true) {
    const trails = frontPathsAt(scenario, timeMs).filter((t) => levelSet.has(t.level) && t.path.length > 1);
    layers.push(
      new PathLayer<{ level: AshLevel; path: LonLat[] }>({
        id: `${id}-trail`,
        data: trails,
        visible,
        opacity,
        getPath: (d) => d.path,
        getColor: (d) => [...palette.level[d.level], palette.trailAlpha],
        getWidth: 1.5,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
        pickable: false,
      }),
    );
  }
  if (opts.showFootprint ?? true) {
    const rings: Ring[] = footprintAt(scenario, timeMs);
    layers.push(
      new PathLayer<Ring>({
        id: `${id}-footprint`,
        data: rings,
        visible,
        opacity,
        getPath: (d) => d,
        getColor: palette.footprint,
        getWidth: 1.25,
        widthUnits: 'pixels',
        jointRounded: true,
        pickable: false,
      }),
    );
  }
  if (opts.showPlaces) {
    const reached = arrivalsBy(scenario, timeMs);
    layers.push(
      new ScatterplotLayer<PlaceArrival>({
        id: `${id}-places`,
        data: reached,
        visible,
        opacity,
        getPosition: (d) => [d.place.lon, d.place.lat],
        getRadius: 4,
        radiusUnits: 'pixels',
        filled: true,
        getFillColor: palette.placeFill,
        stroked: true,
        getLineColor: palette.placeLine,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        pickable: false,
      }),
      new TextLayer<PlaceArrival>({
        id: `${id}-place-labels`,
        data: reached,
        visible,
        opacity,
        getPosition: (d) => [d.place.lon, d.place.lat],
        getText: (d) => `${d.place.name}, ${hoursShort(d.hours)}`,
        getSize: 12,
        sizeUnits: 'pixels',
        getColor: palette.text,
        getPixelOffset: [8, 0],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        characterSet: 'auto',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontWeight: 600,
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        outlineWidth: 3,
        outlineColor: palette.textOutline,
        pickable: false,
      }),
    );
  }
  return layers;
}
