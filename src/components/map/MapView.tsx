// Regional map on MapLibre GL JS + deck.gl. Drop-in replacement for RegionMap (same props, plus the
// optional inputs the haze layer needs).
//
// - Basemap: CARTO Dark Matter by default (dark theme), OpenFreeMap positron as the "Light map" option
//   for projectors, with 3D building extrusions from the vector tiles' building layer at zoom 15 and above. If the style does not load within 5 s (or its tiles all fail),
//   a local style built from the bundled Natural Earth countries (data/region.geojson) takes over, so
//   the map still draws with no network.
// - Heavy geographic layers (distance rings, PSI haze shading, NEA wind arrow and drift cone, modelled
//   wind arrows and haze paths, FIRMS hotspots) are deck.gl layers on one MapboxOverlay.
// - Interactive markers and labels (watch areas, official warnings, gauges, ring and PSI labels) are
//   ordinary React buttons and spans in an HTML overlay above the map. A map "move" listener writes
//   each element's CSS transform directly, so panning and zooming never re-render React.
// - The floating panels publish --overlay-left / --overlay-right on .map-panel; they become the map
//   padding, so flyTo and fitBounds centre in the visible area, and the map's own controls shift clear.
// - The modelled haze, wind particles and city markers belong to HazeLayerController (its own overlay);
//   this component only constructs it after load, updates it and destroys it.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { IControl, LngLatBoundsLike, MapSourceDataEvent, RasterTileSource } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import regionRaw from '../../../data/region.geojson?raw';
import type {
  DriftAssessment,
  HazardType,
  Incident,
  NeaContext,
  OfficialWarning,
  ReviewLabel,
  ReviewState,
} from '../../types';
import type { GaugeReading } from '../../lib/warnings';
import { bmkgLevelInstruction } from '../../lib/warnings';
import { ashDriftTracks, compass16 } from '../../lib/ashDrift';
import type { AshLevel, AshWindData, DriftTrack } from '../../lib/ashDrift';
import { GEOBOUNDARIES_ATTRIBUTION, idnDistrictIndex, placeTsunamiAreas, selectTsunamiAreaWarnings } from '../../lib/tsunamiAreas';
import type { WindGrid } from '../../lib/windField';
import { USGS_TSUNAMI_FLAG_NOTE } from '../../lib/quakesLive';
import type { QuakesResult } from '../../lib/quakesLive';
import { loadSeaLevelStations } from '../../lib/seaLevel';
import { himawariIrLayer, trueColourLayer } from '../../lib/gibs';
import type { QuakeEvent, RiverDischargeSeries, SeaLevelStation } from '../../types';
import { QUAKE_DEPTH_RGB, isRecentQuake, quakeDepthBand, quakeRadiusPx, quakeTooltip, stackNotes } from './connectorRender';
import { RiverFlowPopover, TideGaugePopover } from './ChartPopover';
import { quakeCaption } from './quakeCaption';
import { psiBand } from '../../lib/nea';
import { HAZE_ATTRIBUTION, HazeLayerController } from './HazeLayerController';
import type { AirQualityData, HazeCity, HazeLayerInput } from './HazeLayerController';
import HazeScrubber from './HazeScrubber';
import CityPopover from './CityPopover';
import type { HazeHour } from './useHazeHour';
import {
  arrowAngleDeg,
  buildOfflineStyle,
  conePolygon,
  dashedPaths,
  destination,
  featureBounds,
  keepAtStride,
  overlayPadding,
  psiHazeAlpha,
  ringPolygon,
  selectionBounds,
  twelveHourTicks,
  windArrowStride,
} from './mapGeometry';
import type { Bounds, LonLat, MapHotspot, RegionCollection } from './mapGeometry';
import { PTWC_NATIONAL_AUTHORITIES_NOTE } from '../../lib/ptwc';
import { endedLabel, isExpired, warningMatchesGauge } from '../../lib/warningsView';
import { useNowMs } from '../../lib/useNowMs';
import './MapView.css';

export type { MapHotspot } from './mapGeometry';

/** Modelled wind and illustrative 48 h haze paths, already computed by the shell. Not a dispersion model. */
export interface HazeTransportView {
  /** ISO 8601 UTC grid time the arrows show and the paths start from. */
  time: string;
  /** e.g. "10 m". */
  level: string;
  dataMode: 'live' | 'historical';
  retrievedAt: string;
  /** Wind toward (u east, v north, m/s) on the model grid. */
  arrows: { lat: number; lon: number; u: number; v: number }[];
  paths: { id: string; label: string; points: { lat: number; lon: number; time: string }[]; reaches: boolean }[];
  /** Summary of the path that comes closest to Singapore. */
  summary: string | null;
}

export interface MapViewProps {
  incidents: Incident[];
  selectedId: string | null;
  /** Review state per incident id, for marker styling. */
  states: Record<string, ReviewState>;
  onSelect: (incidentId: string) => void;
  /** NEA Singapore context (live or bundled snapshot): PSI haze shading and the wind arrow. */
  nea?: NeaContext | null;
  /** Drift assessment; when `drift.incidentId === selectedId` the map shows the illustrative drift cone. */
  drift?: DriftAssessment | null;
  /** Short place name per incident id for labels (e.g. "Merapi"); else derived from the title. */
  placeNames?: Record<string, string>;
  className?: string;
  /** Official warnings relayed verbatim: diamonds (dashed when ended); aggregator estimates as hollow dashed circles. */
  warnings?: OfficialWarning[] | null;
  selectedWarningId?: string | null;
  onSelectWarning?: (id: string) => void;
  /** Water-level gauges, drawn only at or above the issuer's lowest threshold (or cited by a drawn warning). */
  gauges?: GaugeReading[] | null;
  /** Clears the selection; the All APAC control calls it and returns to the regional view. */
  onClearSelection?: () => void;
  /** Modelled wind arrows and illustrative haze paths (Open-Meteo); null hides the layer. */
  transport?: HazeTransportView | null;
  /** NASA FIRMS detections behind the selected watch's thermal records, up to the replay day. */
  hotspots?: MapHotspot[] | null;
  /** Wind grid for the haze layer's particles (modelled). */
  windGrid?: WindGrid | null;
  /** Modelled air quality (CAMS via Open-Meteo) for the haze layer. */
  airQuality?: AirQualityData | null;
  /** ISO 8601 UTC hour the haze layer shows when there is no forecast scrubber; defaults to the transport time. */
  hazeTimeISO?: string | null;
  /** Forecast hour state (useHazeHour, held by App). With `airQuality` it shows the haze scrubber. */
  hazeHour?: HazeHour | null;
  /** Called when a haze-layer city marker is clicked, with its pixel position in the map container. */
  onCityClick?: (city: HazeCity, at: { x: number; y: number }) => void;
  /** Haze-layer city to highlight (e.g. while its popover is open). */
  selectedCityId?: string | null;
  /**
   * Basemap and map chrome theme. Without it the map follows document.documentElement.dataset.theme
   * (dark unless "light"); the "Light map" toggle can still switch the basemap.
   */
  theme?: 'dark' | 'light';
  /**
   * Modelled pressure-level winds at the volcano summits (Open-Meteo, live or snapshot). With a volcano
   * selected, the map draws illustrative ash-drift lines at ~3, ~5.5 and ~9 km. Not an ash advisory.
   */
  ashWind?: AshWindData | null;
  /** Earthquakes (USGS and BMKG, one record per agency report, never merged). */
  quakes?: QuakesResult | null;
  /** MODELLED GloFAS river discharge per river point (Open-Meteo). Not a flood warning. */
  riverFlow?: RiverDischargeSeries[] | null;
}

// ---------------------------------------------------------------------------------------------
// Constants

const STYLE_URLS = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://tiles.openfreemap.org/styles/positron',
} as const;
/** Vector sources that carry an OpenMapTiles-style building layer (render_height), per basemap. */
const BUILDING_SOURCES = ['carto', 'openmaptiles'];
const STYLE_TIMEOUT_MS = 5000;
const BUILDINGS_LAYER = 'mv-buildings-3d';
const BUILDINGS_MIN_ZOOM = 15;
const CREDITS = [
  '<a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer">NASA FIRMS</a>',
  HAZE_ATTRIBUTION,
  '<a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noopener noreferrer">NEA, Singapore Open Data Licence</a>',
  'Ash drift: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> pressure-level winds (CC BY 4.0)',
  'Tsunami areas: <a href="https://inatews.bmkg.go.id/" target="_blank" rel="noopener noreferrer">BMKG InaTEWS</a>',
  GEOBOUNDARIES_ATTRIBUTION.replace('geoBoundaries', '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">geoBoundaries</a>'),
];
const MAP_LABEL =
  'Regional map of watch areas and official warnings. Drag or use the arrow keys to pan; scroll, pinch, or plus and minus to zoom.';

/** Reference distances from a volcano's GVP summit point (km). Not a hazard zone. */
const RING_KM = [3, 5, 10, 15];
/** NEA PSI regions at NEA's own label points (data.gov.sg PSI API regionMetadata): [region, lat, lon]. */
const NEA_PSI_REGIONS: ReadonlyArray<[string, number, number]> = [
  ['north', 1.41803, 103.82],
  ['south', 1.29587, 103.82],
  ['east', 1.35735, 103.94],
  ['west', 1.35735, 103.7],
  ['central', 1.35735, 103.82],
];
const PSI_RADIUS_M = 7800;
/** PSI and NEA wind labels appear once the map is zoomed in near Singapore. */
const NEAR_ZOOM = 8.5;
const MAGMA_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';
const VAAC_DARWIN_URL = 'http://www.bom.gov.au/aviation/volcanic-ash/';
/** Ash-drift line colours: neutral cream and tan (red is reserved for official warnings). */
const ASH_INK: Record<'dark' | 'light', Record<AshLevel, RGB>> = {
  dark: { '700': [247, 239, 222], '500': [226, 196, 148], '300': [190, 152, 102] },
  light: { '700': [150, 120, 78], '500': [118, 86, 48], '300': [82, 58, 32] },
};
const ASH_WIDTH: Record<AshLevel, number> = { '700': 3.25, '500': 2.5, '300': 2 };
const MAX_TSUNAMI_MARKERS = 80;
const SINGAPORE: LonLat = [103.8198, 1.3521];
const DRIFT_LENGTH_KM = 111.2;
const DRIFT_HALF_ANGLE_DEG = 15;
const MAX_WARNING_MARKERS = 120;
const MAX_GAUGE_MARKERS = 40;
/** Container width at or below which the compact arrangement applies. */
const NARROW_MAX = 520;
/** Visible map width (between the panels) below which the legend starts closed and the caption is trimmed. */
const TIGHT_MAX = 760;
/** Extra room around a fitted selection, on top of the panel padding. */
const FIT_MARGIN = { top: 72, bottom: 72, left: 56, right: 56 };
const REGION_MARGIN = { top: 24, bottom: 36, left: 16, right: 16 };
const FALLBACK_APAC: Bounds = [
  [92.2, -11],
  [141, 28.6],
];

type RGB = [number, number, number];
const MODELLED: RGB = [74, 47, 141];
const HAZE_TINT: RGB = [122, 92, 58];
const HOTSPOT: RGB = [196, 78, 18];

const NO_HOTSPOTS: MapHotspot[] = [];

const ARROW_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M4 26.5h34V14l24 18-24 18V37.5H4z" fill="#fff"/></svg>',
)}`;
const ARROW_MAPPING = { arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } };

setWorkerUrl(maplibreWorkerUrl);

let regionCache: RegionCollection | null = null;
function getRegion(): RegionCollection {
  if (!regionCache) regionCache = JSON.parse(regionRaw) as RegionCollection;
  return regionCache;
}
let apacCache: Bounds | null = null;
/** The regional view: the ASEAN member states' extent. */
function apacBounds(): Bounds {
  if (!apacCache) {
    try {
      apacCache = featureBounds(getRegion().features.filter((f) => f.properties.asean)) ?? FALLBACK_APAC;
    } catch {
      apacCache = FALLBACK_APAC;
    }
  }
  return apacCache;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Labels and formatting (same wording as the previous map)

const STATE_LABEL: Record<ReviewState, ReviewLabel> = {
  monitoring: 'Monitoring',
  check: 'Check observation',
  review: 'Review needed',
};
const LEGEND_STATES: ReviewState[] = ['monitoring', 'check', 'review'];
const NO_STATE_LABEL = 'Review state unavailable';

const HAZARD_WORD =
  '(?:volcanic|volcano|eruption|wildfires?|fires?|haze|smoke|hotspots?|peatlands?|floods?|flooding|flash|river|observations?)';
const TRAILING_HAZARD = new RegExp(`\\s+${HAZARD_WORD}\\b.*$`, 'i');
const LEADING_HAZARD = new RegExp(`^${HAZARD_WORD}\\b`, 'i');
const TRAILING_CONNECTOR = /\b(?:and|of|in|near|at|the|&)$/i;

/** "Merapi volcanic observations" → "Merapi". Falls back to the full title. */
function placeName(incident: Incident, placeNames?: Record<string, string>): string {
  const given = placeNames?.[incident.id]?.trim();
  if (given) return given;
  const stripped = incident.title.replace(TRAILING_HAZARD, '').trim();
  const usable =
    stripped !== '' &&
    stripped !== incident.title &&
    stripped.split(/\s+/).length <= 3 &&
    !LEADING_HAZARD.test(stripped) &&
    !TRAILING_CONNECTOR.test(stripped);
  return usable ? stripped : incident.title;
}

/** Avoid "Riau · Riau, Indonesia": drop the name from the front of the location. */
function locationRest(name: string, locationName: string): string {
  const loc = locationName.trim();
  if (loc.toLowerCase().startsWith(name.toLowerCase())) return loc.slice(name.length).replace(/^[\s,·–-]+/, '');
  return loc;
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Number(Math.abs(value).toFixed(4))}° ${value < 0 ? negative : positive}`;
}

/** "2026-10-13T06:40:00Z" → "2026-10-13 06:40 UTC" (deterministic, no locale). */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value);
}

function psiChipText(nea: NeaContext): string | null {
  if (!nea.haze) return null;
  const values = Object.values(nea.haze.psi24h).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `Singapore 24-hr PSI ${min === max ? `${min}` : `${min}–${max}`} · ${nea.haze.psiBand} (NEA)`;
}

function windLine(nea: NeaContext): string {
  const label = nea.wind.label.trim() || 'No usable wind reading';
  const variable = nea.wind.consistency < 0.5 && !/variable/i.test(label) ? ', variable' : '';
  return `${label}${variable}`;
}

/** BCP 47 tag for an issuer's verbatim text, so screen readers switch voice; undefined when unknown. */
function issuerLang(issuer: string): string | undefined {
  if (/thaiwater|hydro-informatics/i.test(issuer)) return 'th';
  if (/dsda|dinas|magma|pvmbg|bmkg/i.test(issuer)) return 'id';
  return undefined;
}

function warningTime(w: OfficialWarning): number {
  const t = Date.parse(w.issuedAt ?? '');
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Official before aggregator, then newest issuedAt first (no issue time last). */
function compareWarningMarkers(a: OfficialWarning, b: OfficialWarning): number {
  if (a.authority !== b.authority) return a.authority === 'official' ? -1 : 1;
  const ta = warningTime(a);
  const tb = warningTime(b);
  return ta === tb ? 0 : tb - ta;
}

function gaugeExcess(g: GaugeReading): number | null {
  if (!g.thresholds) return null;
  const values = Object.values(g.thresholds).filter((v) => Number.isFinite(v));
  return values.length === 0 ? null : g.value - Math.min(...values);
}

const stateClass = (state: ReviewState | undefined) => `is-${state ?? 'unknown'}`;

// ---------------------------------------------------------------------------------------------
// Symbols (shared by markers and the legend)

const GLYPHS: Record<HazardType, () => ReactElement> = {
  volcano: () => (
    <g className="mv-glyph-fill">
      <path d="M2 21 9 9.5l1.6 1.1L12 9.4l1.4 1.2L15 9.5 22 21Z" />
      <circle cx="10.4" cy="6" r="1.5" />
      <circle cx="13.7" cy="4.4" r="1.9" />
    </g>
  ),
  wildfire: () => (
    <path
      className="mv-glyph-fill"
      d="M12.5 2.5c.7 3.5 5 5.5 5 11.1a5.5 5.5 0 0 1-11 0c0-3 1.7-4.8 2.9-6.2.2 2.2 1.2 3.5 2.3 3.9-.7-3-.3-6.1.8-8.8Z"
    />
  ),
  flood: () => (
    <g className="mv-glyph-stroke">
      <path d="M2.5 7.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
      <path d="M2.5 12.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
      <path d="M2.5 17.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
    </g>
  ),
};

/** Round watch-area symbol in a 32×32 box: ring in the state colour, hazard glyph, optional "!" disc. */
function MarkerSymbol({ hazard, state, selected = false }: { hazard: HazardType | null; state: ReviewState | undefined; selected?: boolean }) {
  const Glyph = hazard ? GLYPHS[hazard] : null;
  return (
    <>
      {selected && <circle className="mv-select-ring" cx="16" cy="16" r="15" />}
      <circle className="mv-ring" cx="16" cy="16" r="12.5" />
      {Glyph && (
        <g transform="translate(8.5 8.5) scale(0.625)">
          <Glyph />
        </g>
      )}
      {state === 'review' && (
        <g className="mv-badge">
          <circle cx="26.5" cy="5.5" r="5" />
          <path d="M26.5 3v3.3" />
          <circle className="mv-badge-dot" cx="26.5" cy="8.4" r="0.95" />
        </g>
      )}
    </>
  );
}

type OfficialKind = 'official' | 'ended' | 'estimate' | 'gauge';

/** Reserved official-style symbols: diamond = official warning (dashed when ended), hollow dashed circle = impact estimate, square = gauge. */
function OfficialSymbol({ kind, selected = false }: { kind: OfficialKind; selected?: boolean }) {
  return (
    <>
      {selected && <circle className="mv-select-ring" cx="10" cy="10" r="9" />}
      {kind === 'estimate' ? (
        <circle className="mv-wcircle" cx="10" cy="10" r="4.5" />
      ) : kind === 'gauge' ? (
        <rect className="mv-gsquare" x="5" y="5" width="10" height="10" />
      ) : (
        <rect className={`mv-wdiamond${kind === 'ended' ? ' is-ended' : ''}`} x="4" y="4" width="12" height="12" transform="rotate(45 10 10)" />
      )}
    </>
  );
}

function NeaSwatch({ kind, variable = false }: { kind: 'wind' | 'drift' | 'both'; variable?: boolean }) {
  return (
    <svg className="mv-nea-swatch" viewBox="0 0 22 16" aria-hidden="true" focusable="false">
      {kind !== 'wind' && <path className="mv-drift" d="M2 13 L18 3.5 A12 12 0 0 1 20 9.5 Z" />}
      {kind !== 'drift' && (
        <g className={`mv-wind${variable ? ' is-variable' : ''}`}>
          <line x1="3" y1="12" x2="14" y2="5" />
          <path className="mv-wind-tip" d="M19 2 L12.4 3.1 L15.6 8.1 Z" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Imperative overlay layout helpers (stage pixels)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type TagPos = 'right' | 'left' | 'below' | 'above' | 'below-right' | 'above-right' | 'below-left' | 'above-left';

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function outside(r: Rect, f: Rect): number {
  const inside = overlap(r, f);
  return r.w * r.h - inside;
}

function tagRect(px: number, py: number, pos: TagPos, w: number, h: number, gap: number): Rect {
  switch (pos) {
    case 'right':
      return { x: px + gap, y: py - h / 2, w, h };
    case 'left':
      return { x: px - gap - w, y: py - h / 2, w, h };
    case 'below':
      return { x: px - w / 2, y: py + gap, w, h };
    case 'above':
      return { x: px - w / 2, y: py - gap - h, w, h };
    case 'below-right':
      return { x: px + gap * 0.6, y: py + gap * 0.6, w, h };
    case 'above-right':
      return { x: px + gap * 0.6, y: py - gap * 0.6 - h, w, h };
    case 'below-left':
      return { x: px - gap * 0.6 - w, y: py + gap * 0.6, w, h };
    case 'above-left':
      return { x: px - gap * 0.6 - w, y: py - gap * 0.6 - h, w, h };
  }
}

const TAG_POSITIONS: TagPos[] = ['right', 'left', 'below', 'above', 'below-right', 'above-right', 'below-left', 'above-left'];

const num = (v: string | undefined) => Number(v);

// ---------------------------------------------------------------------------------------------

/** The theme from the prop, else the document's data-theme (dark unless "light"). */
function resolveTheme(theme: 'dark' | 'light' | undefined): 'dark' | 'light' {
  if (theme) return theme;
  try {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

interface LayerToggles {
  watch: boolean;
  warnings: boolean;
  nea: boolean;
  transport: boolean;
  haze: boolean;
  particles: boolean;
  rings: boolean;
  buildings: boolean;
  ash: boolean;
  tsunami: boolean;
  quakes: boolean;
  tide: boolean;
  river: boolean;
  satIr: boolean;
  satTrue: boolean;
}

export default function MapView({
  incidents,
  selectedId,
  states,
  onSelect,
  nea = null,
  drift = null,
  placeNames,
  className,
  warnings = null,
  selectedWarningId = null,
  onSelectWarning,
  gauges = null,
  onClearSelection,
  transport = null,
  hotspots = null,
  windGrid = null,
  airQuality = null,
  hazeTimeISO = null,
  onCityClick,
  selectedCityId = null,
  hazeHour = null,
  theme,
  ashWind = null,
  quakes = null,
  riverFlow = null,
}: MapViewProps) {
  const calloutId = useId();
  const layersTitleId = useId();
  const [layers, setLayers] = useState<LayerToggles>({
    watch: true,
    warnings: true,
    nea: true,
    transport: true,
    haze: true,
    particles: true,
    rings: true,
    buildings: true,
    ash: true,
    tsunami: true,
    quakes: true,
    tide: false,
    river: false,
    satIr: false,
    satTrue: false,
  });
  /** Satellite imagery opacity (0..1), shared by both GIBS layers. */
  const [satOpacity, setSatOpacity] = useState(0.75);
  /** Open chart popover: a tide gauge (code) or a river point (id), at a point in the map container. */
  const [chart, setChart] = useState<{ kind: 'tide' | 'river'; id: string; at: { x: number; y: number } } | null>(null);
  /** "History: last BMKG tsunami warning" (only offered when no BMKG tsunami warning is in force). Off by default. */
  const [tsunamiHistory, setTsunamiHistory] = useState(false);
  /** Shared wall clock (every 5 min, on visible, on online): the Himawari frame, "last 24 h" quakes, the ash-drift start, expiry. */
  const nowMs = useNowMs();
  const [dark, setDark] = useState(() => resolveTheme(theme) === 'dark');
  const [narrow, setNarrow] = useState(false);
  /** The map visible between the panels is narrow (under TIGHT_MAX px): legend closed, caption trimmed. */
  const [tight, setTight] = useState(false);
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [stride, setStride] = useState(4);
  /** Haze-layer city whose popover is open, with the click point in the map container. */
  const [city, setCity] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  /** Roving tabindex for the official/gauge markers: index of the one tab stop. */
  const [officialActive, setOfficialActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const probeLRef = useRef<HTMLSpanElement>(null);
  const probeRRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const deckRef = useRef<MapboxOverlay | null>(null);
  const hazeRef = useRef<HazeLayerController | null>(null);
  const padRef = useRef({ left: 0, right: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const darkRef = useRef(dark);
  const narrowRef = useRef(false);
  const buildingsRef = useRef(true);
  const anchorsRef = useRef<HTMLElement[]>([]);
  const officialRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const applyStyleRef = useRef<((dark: boolean) => void) | null>(null);
  /**
   * True from 'style.load' until the style is swapped (applyStyle, goOffline, retryStyle). Sources and
   * layers can be added then. map.isStyleLoaded() is not usable for that: in MapLibre 6.14 it is false
   * whenever any tiles are in flight, and still false inside 'style.load' while the sprite loads.
   */
  const styleReadyRef = useRef(false);
  /** A GIBS sync is already queued for the next 'style.load'. */
  const gibsDeferredRef = useRef(false);
  /** Retries the live basemap after the offline fallback (the online event or the Retry button). */
  const retryStyleRef = useRef<(() => void) | null>(null);
  const deckLayersRef = useRef<LayersList>([]);
  const hazeInputRef = useRef<HazeLayerInput | null>(null);
  const officialTabRef = useRef(-1);

  // --- Derived data (memoised; none of it depends on the camera) ------------------------------

  const placed = useMemo(
    () =>
      incidents
        .filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon))
        .map((incident) => {
          const state = states[incident.id] as ReviewState | undefined;
          return { incident, state, stateLabel: state ? STATE_LABEL[state] : NO_STATE_LABEL, name: placeName(incident, placeNames) };
        }),
    [incidents, states, placeNames],
  );
  const selected = placed.find((p) => p.incident.id === selectedId) ?? null;
  const selectedIncident = selected?.incident ?? null;
  const neaActive = Boolean(selected && nea && drift && drift.incidentId === selected.incident.id);
  const neaShown = neaActive && layers.nea;
  const downwindDeg = neaShown && drift && drift.downwindDeg !== null && Number.isFinite(drift.downwindDeg) ? drift.downwindDeg : null;

  const warningMarkers = useMemo(
    () =>
      (warnings ?? [])
        .filter((w) => w.location && Number.isFinite(w.location.lat) && Number.isFinite(w.location.lon))
        .sort(compareWarningMarkers)
        .slice(0, MAX_WARNING_MARKERS),
    [warnings],
  );

  const gaugeMarkers = useMemo(() => {
    const drawnIds = warningMarkers.map((w) => w.id);
    return (gauges ?? [])
      .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon) && Number.isFinite(g.value))
      .map((gauge) => ({ gauge, excess: gaugeExcess(gauge) }))
      .filter((m) => (m.excess !== null ? m.excess >= 0 : m.gauge.situation !== null && drawnIds.some((id) => warningMatchesGauge(id, m.gauge.id))))
      .sort((a, b) => (b.excess ?? Number.NEGATIVE_INFINITY) - (a.excess ?? Number.NEGATIVE_INFINITY) || 0)
      .slice(0, MAX_GAUGE_MARKERS)
      .map((m) => m.gauge);
  }, [gauges, warningMarkers]);

  const ringsShown = Boolean(selectedIncident && selectedIncident.hazard === 'volcano' && layers.rings && layers.watch);
  const rings = useMemo(
    () =>
      ringsShown && selectedIncident
        ? RING_KM.map((km) => ({
            km,
            polygon: ringPolygon(selectedIncident.lon, selectedIncident.lat, km),
            label: destination(selectedIncident.lon, selectedIncident.lat, 0, km),
          }))
        : null,
    [ringsShown, selectedIncident],
  );

  const hazeRegions = useMemo(() => {
    const haze = nea?.haze;
    if (!haze || !layers.nea) return null;
    const out: { region: string; psi: number; band: string; lon: number; lat: number }[] = [];
    for (const [region, lat, lon] of NEA_PSI_REGIONS) {
      const psi = haze.psi24h[region];
      if (typeof psi === 'number' && Number.isFinite(psi)) out.push({ region, psi, band: psiBand(psi), lon, lat });
    }
    return out.length ? { regions: out, mode: haze.dataMode === 'historical' ? 'SNAPSHOT' : 'LIVE', time: haze.observedAt.slice(11, 16) } : null;
  }, [nea, layers.nea]);

  /** NEA wind at Singapore (toward), drawn whenever the NEA layer is on and a direction is known. */
  const seaWindToward =
    nea && layers.nea && nea.wind.fromDeg !== null && Number.isFinite(nea.wind.fromDeg) ? (nea.wind.fromDeg + 180) % 360 : null;
  const windVariable = Boolean(nea && nea.wind.consistency < 0.5);

  const driftCone = useMemo(
    () =>
      selectedIncident && downwindDeg !== null
        ? {
            polygon: conePolygon(selectedIncident.lon, selectedIncident.lat, downwindDeg, DRIFT_LENGTH_KM, DRIFT_HALF_ANGLE_DEG),
            label: destination(selectedIncident.lon, selectedIncident.lat, downwindDeg, DRIFT_LENGTH_KM * 0.62),
          }
        : null,
    [selectedIncident, downwindDeg],
  );

  const transportShown = Boolean(transport && layers.transport);
  const hotspotsShown = layers.watch && hotspots ? hotspots : NO_HOTSPOTS;
  const hotspotsToday = hotspotsShown.filter((h) => h.current).length;

  // Illustrative ash drift (modelled) for the selected volcano: three heights from the GVP summit.
  const ashSeries = useMemo(() => {
    if (!ashWind || !selectedIncident || selectedIncident.hazard !== 'volcano' || !selectedIncident.volcanoId) return null;
    return ashWind.volcanoes.find((v) => v.volcanoId === selectedIncident.volcanoId) ?? null;
  }, [ashWind, selectedIncident]);
  const ashDrift = useMemo(() => (ashSeries ? ashDriftTracks(ashSeries, nowMs) : null), [ashSeries, nowMs]);
  const ashShown = Boolean(ashDrift && layers.ash);

  // Official BMKG InaTEWS tsunami warning areas (verbatim levels) at district centres (approximate).
  const tsunamiPick = useMemo(() => selectTsunamiAreaWarnings(warnings, nowMs), [warnings, nowMs]);
  const tsunamiInForce = tsunamiPick.inForce !== null;
  const tsunamiWarning = tsunamiPick.inForce ?? (tsunamiHistory ? tsunamiPick.latest : null);
  const tsunamiPlacement = useMemo(() => (tsunamiWarning ? placeTsunamiAreas(tsunamiWarning.areas, idnDistrictIndex()) : null), [tsunamiWarning]);
  const tsunamiShown = Boolean(tsunamiWarning && tsunamiPlacement && layers.tsunami);
  const tsunamiAreaMarkers = tsunamiShown && tsunamiPlacement ? tsunamiPlacement.placed.slice(0, MAX_TSUNAMI_MARKERS) : [];
  const tsunamiObsMarkers = tsunamiShown && tsunamiWarning ? (tsunamiWarning.observations ?? []).slice(0, MAX_TSUNAMI_MARKERS) : [];

  // Tide gauges come on by themselves whenever official tsunami areas (in force or History) are shown.
  useEffect(() => {
    if (tsunamiShown) setLayers((prev) => (prev.tide ? prev : { ...prev, tide: true }));
  }, [tsunamiShown]);

  // Connector layers: earthquakes (USGS, BMKG), IOC tide gauges, modelled river flow, GIBS imagery.
  const quakesShown = useMemo<QuakeEvent[]>(
    () =>
      layers.quakes && quakes
        ? quakes.events
            .filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon) && Number.isFinite(q.magnitude))
            .slice()
            .sort((a, b) => Date.parse(a.timeISO) - Date.parse(b.timeISO))
        : [],
    [layers.quakes, quakes],
  );
  const tideStations = useMemo<SeaLevelStation[]>(() => {
    try {
      return loadSeaLevelStations().stations;
    } catch {
      return [];
    }
  }, []);
  const tideShown = useMemo(() => (layers.tide ? tideStations : []), [layers.tide, tideStations]);
  const riverShown = useMemo(() => (layers.river && riverFlow ? riverFlow : []), [layers.river, riverFlow]);
  const gibsIr = useMemo(() => himawariIrLayer(nowMs), [nowMs]);
  const gibsTrue = useMemo(() => trueColourLayer(nowMs), [nowMs]);
  const gibsShown = [...(layers.satTrue ? [gibsTrue] : []), ...(layers.satIr ? [gibsIr] : [])];
  const gibsRef = useRef({ ir: false, tc: false, opacity: 0.75 });
  gibsRef.current = { ir: layers.satIr, tc: layers.satTrue, opacity: satOpacity };

  // --- deck.gl layers (rebuilt only when inputs change, never per frame) -----------------------

  const deckLayers = useMemo<LayersList>(() => {
    const out: LayersList = [];
    // Dark (default): cream rings, tan smoke, light amber paths, dark halos. Light: slate, brown haze, violet paths.
    const ringInk: RGB = dark ? [236, 228, 214] : [51, 71, 91];
    const ink: RGB = dark ? [236, 228, 214] : [20, 26, 34];
    const halo: RGB = dark ? [10, 18, 24] : [255, 255, 255];
    const smoke: RGB = dark ? [210, 180, 140] : HAZE_TINT;
    const pathColor: RGB = dark ? [255, 200, 120] : MODELLED;

    if (hazeRegions) {
      out.push(
        new ScatterplotLayer<(typeof hazeRegions.regions)[number]>({
          id: 'mv-psi-haze',
          data: hazeRegions.regions,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'meters',
          getRadius: PSI_RADIUS_M,
          getFillColor: (d) => [...smoke, Math.round(Math.min(1, psiHazeAlpha(d.band) * (dark ? 1.2 : 1)) * 255)],
          stroked: false,
          updateTriggers: { getFillColor: [dark] },
        }),
      );
    }
    if (rings) {
      out.push(
        // Reference distances: a faint fill that darkens toward the summit, and thin dashed outlines with a halo.
        new PolygonLayer<(typeof rings)[number]>({
          id: 'mv-rings',
          data: [...rings].reverse(),
          getPolygon: (d) => d.polygon,
          filled: true,
          getFillColor: [...ringInk, dark ? 14 : 20],
          stroked: false,
          updateTriggers: { getFillColor: [dark] },
        }),
        new PathLayer<LonLat[]>({
          id: 'mv-rings-halo',
          data: rings.flatMap((r) => dashedPaths(r.polygon, 2, 1)),
          getPath: (d) => d,
          getColor: [...halo, dark ? 150 : 120],
          getWidth: 3.5,
          widthUnits: 'pixels',
          updateTriggers: { getColor: [dark] },
        }),
        new PathLayer<LonLat[]>({
          id: 'mv-rings-dash',
          data: rings.flatMap((r) => dashedPaths(r.polygon, 2, 1)),
          getPath: (d) => d,
          getColor: [...ringInk, 230],
          getWidth: 1.5,
          widthUnits: 'pixels',
          updateTriggers: { getColor: [dark] },
        }),
      );
    }
    if (driftCone) {
      out.push(
        new PolygonLayer<{ polygon: LonLat[] }>({
          id: 'mv-drift-cone',
          data: [{ polygon: driftCone.polygon }],
          getPolygon: (d) => d.polygon,
          filled: true,
          getFillColor: dark ? [236, 228, 214, 34] : [78, 89, 103, 42],
          stroked: true,
          getLineColor: dark ? [236, 228, 214, 140] : [78, 89, 103, 150],
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
        }),
      );
    }
    if (seaWindToward !== null) {
      // NEA station wind at Singapore: a fixed-size arrow (pixels), so it reads the same at every zoom.
      const angle = 90 - seaWindToward;
      const alpha = windVariable ? 150 : 255;
      const at = [{ position: SINGAPORE }];
      out.push(
        new IconLayer<{ position: LonLat }>({
          id: 'mv-nea-wind-halo',
          data: at,
          iconAtlas: ARROW_ICON,
          iconMapping: ARROW_MAPPING,
          getIcon: () => 'arrow',
          getPosition: (d) => d.position,
          getAngle: () => angle,
          getSize: 64,
          sizeUnits: 'pixels',
          getColor: [...halo, 210],
          updateTriggers: { getAngle: [angle], getColor: [dark] },
        }),
        new IconLayer<{ position: LonLat }>({
          id: 'mv-nea-wind',
          data: at,
          iconAtlas: ARROW_ICON,
          iconMapping: ARROW_MAPPING,
          getIcon: () => 'arrow',
          getPosition: (d) => d.position,
          getAngle: () => angle,
          getSize: 56,
          sizeUnits: 'pixels',
          getColor: [...ink, alpha],
          updateTriggers: { getAngle: [angle], getColor: [dark, alpha] },
        }),
      );
    }
    if (transport && transportShown) {
      // The haze layer's 925 hPa particles replace the 10 m arrows when its wind grid is loaded; the paths stay.
      const arrows = windGrid ? [] : transport.arrows.filter((a) => keepAtStride(a.lat, a.lon, stride) && Math.hypot(a.u, a.v) > 0.05);
      out.push(
        new IconLayer<(typeof arrows)[number]>({
          id: 'mv-wind-arrows',
          data: arrows,
          iconAtlas: ARROW_ICON,
          iconMapping: ARROW_MAPPING,
          getIcon: () => 'arrow',
          getPosition: (d) => [d.lon, d.lat],
          getAngle: (d) => arrowAngleDeg(d.u, d.v),
          getSize: (d) => 10 + Math.min(Math.hypot(d.u, d.v), 15) * 1.4,
          sizeUnits: 'pixels',
          getColor: dark ? [255, 200, 120, 165] : [...MODELLED, 165],
          updateTriggers: { getColor: [dark] },
        }),
      );
      const paths = transport.paths.filter((t) => t.points.length > 1);
      out.push(
        new PathLayer<(typeof paths)[number]>({
          id: 'mv-haze-paths',
          data: paths,
          getPath: (d) => d.points.map((p) => [p.lon, p.lat] as LonLat),
          getColor: (d) => [...pathColor, d.reaches ? 235 : 170],
          getWidth: (d) => (d.reaches ? 2.75 : 2),
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          updateTriggers: { getColor: [dark] },
        }),
        new ScatterplotLayer<LonLat>({
          id: 'mv-haze-ticks',
          data: paths.flatMap((t) => twelveHourTicks(t.points)),
          getPosition: (d) => d,
          radiusUnits: 'pixels',
          getRadius: 3,
          filled: true,
          getFillColor: [...halo, 255],
          stroked: true,
          getLineColor: [...pathColor, 220],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.4,
        }),
      );
    }
    if (hotspotsShown.length > 0) {
      out.push(
        new ScatterplotLayer<MapHotspot>({
          id: 'mv-firms',
          data: hotspotsShown,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => (d.current ? 5 : 3.5),
          filled: true,
          getFillColor: (d) => [...HOTSPOT, d.current ? 235 : 95],
          stroked: true,
          getLineColor: (d) => [...halo, d.current ? 255 : 150],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.2,
          pickable: true,
          updateTriggers: { getLineColor: [dark] },
        }),
      );
    }
    if (ashShown && ashDrift) {
      const inks = ASH_INK[dark ? 'dark' : 'light'];
      const tracks = ashDrift.tracks.filter((t) => t.points.length > 1);
      const ticks = tracks.flatMap((t) => t.ticks.map((k) => ({ ...k, level: t.level })));
      // The 24 h tick carries the height label instead of an hour label; heights stack so ends never collide.
      const tickLabels = ticks.filter((k) => k.hour < 24);
      const labelDy: Record<AshLevel, number> = { '700': -10, '500': 0, '300': 10 };
      const ends = tracks.map((t) => ({ track: t, at: t.points[t.points.length - 1] }));
      const outline: [number, number, number, number] = [...halo, 235];
      out.push(
        new PathLayer<DriftTrack>({
          id: 'mv-ash-halo',
          data: tracks,
          getPath: (d) => d.points.map((p) => [p.lon, p.lat] as LonLat),
          getColor: [...halo, dark ? 190 : 210],
          getWidth: (d) => ASH_WIDTH[d.level] + 3,
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          updateTriggers: { getColor: [dark] },
        }),
        new PathLayer<DriftTrack>({
          id: 'mv-ash-paths',
          data: tracks,
          getPath: (d) => d.points.map((p) => [p.lon, p.lat] as LonLat),
          getColor: (d) => [...inks[d.level], 245],
          getWidth: (d) => ASH_WIDTH[d.level],
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          updateTriggers: { getColor: [dark] },
        }),
        new ScatterplotLayer<(typeof ticks)[number]>({
          id: 'mv-ash-ticks',
          data: ticks,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: 3.5,
          filled: true,
          getFillColor: [...halo, 255],
          stroked: true,
          getLineColor: (d) => [...inks[d.level], 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.6,
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
        new TextLayer<(typeof tickLabels)[number]>({
          id: 'mv-ash-tick-labels',
          data: tickLabels,
          getPosition: (d) => [d.lon, d.lat],
          getText: (d) => `${d.hour} h`,
          getSize: 11,
          sizeUnits: 'pixels',
          getColor: (d) => [...inks[d.level], 255],
          getPixelOffset: [7, -9],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 600,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: outline,
          updateTriggers: { getColor: [dark] },
        }),
        new TextLayer<(typeof ends)[number]>({
          id: 'mv-ash-level-labels',
          data: ends,
          getPosition: (d) => [d.at.lon, d.at.lat],
          getText: (d) => `${d.track.label}${d.track.ticks.some((k) => k.hour === 24) ? ' (24 h)' : ''}`,
          getSize: 13,
          sizeUnits: 'pixels',
          getColor: (d) => [...inks[d.track.level], 255],
          getPixelOffset: (d) => [9, labelDy[d.track.level]],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 700,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: outline,
          updateTriggers: { getColor: [dark] },
        }),
      );
    }
    if (tideShown.length > 0) {
      const tideInk: RGB = dark ? [150, 200, 235] : [30, 96, 150];
      out.push(
        new ScatterplotLayer<SeaLevelStation>({
          id: 'mv-tide',
          data: tideShown,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: 3.5,
          filled: true,
          getFillColor: [...tideInk, 230],
          stroked: true,
          getLineColor: [...halo, 230],
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          pickable: true,
          onClick: (info) => {
            const st = info.object as SeaLevelStation | undefined;
            if (st) setChart({ kind: 'tide', id: st.code, at: { x: info.x, y: info.y } });
            return true;
          },
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
      );
    }
    if (quakesShown.length > 0) {
      const alpha = (q: QuakeEvent) => (isRecentQuake(q.timeISO, nowMs) ? 240 : 105);
      const colour = (q: QuakeEvent): [number, number, number, number] => [...QUAKE_DEPTH_RGB[quakeDepthBand(q.depthKm)], alpha(q)];
      const usgs = quakesShown.filter((q) => q.source === 'USGS');
      const bmkg = quakesShown.filter((q) => q.source === 'BMKG');
      out.push(
        // USGS: filled discs with a halo. BMKG: open rings, slightly larger, so both reports of one event stay visible.
        new ScatterplotLayer<QuakeEvent>({
          id: 'mv-quakes-usgs',
          data: usgs,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => quakeRadiusPx(d.magnitude),
          filled: true,
          getFillColor: colour,
          stroked: true,
          getLineColor: (d) => [...halo, isRecentQuake(d.timeISO, nowMs) ? 255 : 140],
          lineWidthUnits: 'pixels',
          getLineWidth: (d) => (isRecentQuake(d.timeISO, nowMs) ? 1.6 : 0.8),
          pickable: true,
          updateTriggers: { getLineColor: [dark, nowMs], getFillColor: [nowMs], getLineWidth: [nowMs] },
        }),
        new ScatterplotLayer<QuakeEvent>({
          id: 'mv-quakes-bmkg',
          data: bmkg,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => quakeRadiusPx(d.magnitude) + 2,
          filled: false,
          stroked: true,
          getLineColor: colour,
          lineWidthUnits: 'pixels',
          getLineWidth: (d) => (isRecentQuake(d.timeISO, nowMs) ? 2.2 : 1.2),
          pickable: true,
          updateTriggers: { getLineColor: [nowMs], getLineWidth: [nowMs] },
        }),
      );
    }
    return out;
  }, [
    hazeRegions,
    rings,
    driftCone,
    seaWindToward,
    windVariable,
    transport,
    transportShown,
    stride,
    hotspotsShown,
    dark,
    windGrid,
    ashShown,
    ashDrift,
    quakesShown,
    tideShown,
    nowMs,
  ]);

  useEffect(() => {
    deckLayersRef.current = deckLayers;
    deckRef.current?.setProps({ layers: deckLayers });
  }, [deckLayers]);

  // --- Haze layer controller (owned by the haze agent) ----------------------------------------

  const handleCityClick = useCallback(
    (c: HazeCity, at: { x: number; y: number }) => {
      setCity({ id: c.id, at });
      onCityClick?.(c, at);
    },
    [onCityClick],
  );
  const hazeTimeShown = hazeHour?.timeISO ?? hazeTimeISO ?? transport?.time ?? windGrid?.times[0] ?? '';
  const hazeInput = useMemo<HazeLayerInput>(
    () => ({
      windGrid,
      airQuality,
      timeISO: hazeTimeShown,
      dark,
      visible: { particles: layers.particles, haze: layers.haze, cities: layers.haze },
      onCityClick: handleCityClick,
      neaHaze: layers.nea ? (nea?.haze ?? null) : null,
      selectedCityId: selectedCityId ?? city?.id ?? null,
    }),
    [windGrid, airQuality, hazeTimeShown, dark, layers.particles, layers.haze, layers.nea, handleCityClick, nea, selectedCityId, city],
  );
  useEffect(() => {
    hazeInputRef.current = hazeInput;
    try {
      hazeRef.current?.update(hazeInput);
    } catch (err) {
      console.error('Haze layer could not be updated:', err);
    }
  }, [hazeInput]);

  // --- Imperative overlay positioning (runs on map move; no React state) ----------------------

  const positionOverlays = useCallback(() => {
    const map = mapRef.current;
    const root = overlayRef.current;
    if (!map || !root) return;
    const { w, h } = sizeRef.current;
    for (const el of anchorsRef.current) {
      const p = map.project([num(el.dataset.lon), num(el.dataset.lat)]);
      const off = !(p.x > -80 && p.y > -80 && p.x < w + 80 && p.y < h + 80);
      if (off) {
        if (el.dataset.off !== '1') el.dataset.off = '1';
        continue;
      }
      if (el.dataset.off === '1') el.dataset.off = '0';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
    const near = map.getZoom() >= NEAR_ZOOM ? 'true' : 'false';
    if (root.dataset.near !== near) root.dataset.near = near;
  }, []);

  /** Tag sides (greedy, avoiding markers, other tags and the panels) and warning hover sides; on moveend only. */
  const layoutTags = useCallback(() => {
    const map = mapRef.current;
    const root = overlayRef.current;
    if (!map || !root) return;
    const { w, h } = sizeRef.current;
    const frame: Rect = { x: padRef.current.left, y: 0, w: Math.max(0, w - padRef.current.left - padRef.current.right), h };
    const markers = Array.from(root.querySelectorAll<HTMLElement>('.mv-marker')).filter((el) => el.dataset.off !== '1');
    markers.sort((a, b) => Number(b.classList.contains('is-selected')) - Number(a.classList.contains('is-selected')));
    const pts = markers.map((el) => map.project([num(el.dataset.lon), num(el.dataset.lat)]));
    const occupied: (Rect & { weight?: number })[] = pts.map((p) => ({ x: p.x - 17, y: p.y - 17, w: 34, h: 34 }));
    // The map's own cards (legend, NEA, caption, All APAC) count as obstacles for the tags.
    const base = root.getBoundingClientRect();
    rootRef.current?.querySelectorAll<HTMLElement>('.mv-legend, .mv-compact, .mv-nea, .mv-caption, .mv-scrubber, .mv-home').forEach((card) => {
      const b = card.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) occupied.push({ x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height, weight: 3 });
    });
    const wmarkers = Array.from(root.querySelectorAll<HTMLElement>('.mv-wmarker')).filter((el) => el.dataset.off !== '1');
    for (const el of wmarkers) {
      const p = map.project([num(el.dataset.lon), num(el.dataset.lat)]);
      occupied.push({ x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
      el.dataset.side = `${p.x - frame.x > frame.w * 0.62 ? 'l' : 'r'}${p.y > h * 0.72 ? 'u' : 'd'}`;
    }
    markers.forEach((el, i) => {
      const tag = el.querySelector<HTMLElement>('.mv-tag');
      if (!tag) return;
      const tw = tag.offsetWidth;
      const th = tag.offsetHeight;
      const gap = el.classList.contains('is-selected') ? 23 : 20;
      let best: { pos: TagPos; rect: Rect; score: number } | null = null;
      for (const pos of TAG_POSITIONS) {
        const rect = tagRect(pts[i].x, pts[i].y, pos, tw, th, gap);
        let score = outside(rect, frame) * 3;
        occupied.forEach((o, j) => {
          if (j !== i) score += overlap(rect, o) * (o.weight ?? 1);
        });
        if (!best || score < best.score) best = { pos, rect, score };
        if (score === 0) break;
      }
      if (best) {
        if (el.dataset.tag !== best.pos) el.dataset.tag = best.pos;
        // A tag that cannot fit inside the visible map is hidden (the marker and its aria-label stay).
        const clip = outside(best.rect, frame) > 0 ? '1' : '0';
        if (el.dataset.clip !== clip) el.dataset.clip = clip;
        occupied.push(best.rect);
      }
    });
    // Keep the official group reachable by Tab: its one tab stop must be on screen.
    const stop = officialTabRef.current;
    const stopEl = stop >= 0 ? officialRefs.current[stop] : null;
    if (stopEl && stopEl.dataset.off === '1') {
      const firstVisible = officialRefs.current.findIndex((b) => b && b.dataset.off !== '1');
      if (firstVisible >= 0) setOfficialActive(firstVisible);
    }
  }, []);

  /** Floating panels → map padding. The map content stays still; only later camera moves use the new centre. */
  const syncPadding = useCallback(() => {
    const map = mapRef.current;
    const root = rootRef.current;
    if (!map || !root) return;
    // The custom properties hold calc() expressions; two hidden probes resolve them to pixels.
    const width = root.clientWidth;
    const next = overlayPadding(probeLRef.current?.offsetWidth ?? 0, probeRRef.current?.offsetWidth ?? 0, width);
    padRef.current = next;
    const isTight = width - next.left - next.right < TIGHT_MAX;
    setTight((prev) => (prev === isTight ? prev : isTight));
    const prev = map.getPadding();
    if (prev.left === next.left && prev.right === next.right) return;
    const padding = { top: 0, bottom: 0, left: next.left, right: next.right };
    if (map.isMoving()) {
      map.setPadding(padding);
      return;
    }
    const cx = next.left + (width - next.left - next.right) / 2;
    map.jumpTo({ center: map.unproject([cx, root.clientHeight / 2]), padding });
  }, []);

  /** Fly to a selection (±0.3° around a summit, or the watch box with a margin), or back to the region. */
  const fitTo = useCallback(
    (incident: Incident | null, animate: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      syncPadding();
      const { w, h } = sizeRef.current;
      const visW = Math.max(0, w - padRef.current.left - padRef.current.right);
      const want = incident ? FIT_MARGIN : REGION_MARGIN;
      // The bottom dock (forecast scrubber, caption) covers the lower map: keep the fit above it.
      const dock = rootRef.current?.querySelector<HTMLElement>('.mv-dock');
      const dockH = dock ? dock.offsetHeight + 40 : 0;
      const m = {
        top: Math.min(want.top, h / 5),
        bottom: Math.min(Math.max(want.bottom, dockH), h * 0.4),
        left: Math.min(want.left, visW / 6),
        right: Math.min(want.right, visW / 6),
      };
      const bounds: LngLatBoundsLike = incident ? selectionBounds(incident) : apacBounds();
      const duration = animate && !prefersReducedMotion() ? (incident ? 1800 : 1400) : 0;
      map.fitBounds(bounds, {
        padding: m,
        duration,
        maxZoom: 14,
        essential: false,
        bearing: 0,
        pitch: 0,
      });
    },
    [syncPadding],
  );

  /** NASA GIBS rasters under the deck overlays and the basemap labels; idempotent, safe before style load. */
  const syncGibsRef = useRef<() => void>(() => {});
  syncGibsRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!styleReadyRef.current) {
      // A basemap swap is in progress (addSource would throw): sync once the new style has loaded.
      if (!gibsDeferredRef.current) {
        gibsDeferredRef.current = true;
        map.once('style.load', () => {
          gibsDeferredRef.current = false;
          syncGibsRef.current();
        });
      }
      return;
    }
    const want = gibsRef.current;
    for (const [spec, on] of [
      [gibsTrue, want.tc],
      [gibsIr, want.ir],
    ] as const) {
      const layerId = `${spec.id}-layer`;
      try {
        if (on) {
          const source = map.getSource<RasterTileSource>(spec.id);
          if (!source) {
            map.addSource(spec.id, { type: 'raster', tiles: spec.tiles, tileSize: spec.tileSize, maxzoom: spec.maxzoom, attribution: spec.attribution });
          } else if (source.tiles?.[0] !== spec.tiles[0]) {
            // The clock moved on (a newer Himawari slot or UTC day): same layer, the caption's image time.
            source.setTiles(spec.tiles);
          }
          if (!map.getLayer(layerId)) {
            const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
            // Overzoom past maxzoom: MapLibre scales the last level up; the raster keeps showing when zoomed in.
            map.addLayer({ id: layerId, type: 'raster', source: spec.id, paint: { 'raster-opacity': want.opacity, 'raster-fade-duration': 0 } }, firstSymbol);
          } else {
            map.setPaintProperty(layerId, 'raster-opacity', want.opacity);
          }
        } else {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(spec.id)) map.removeSource(spec.id);
        }
      } catch (err) {
        console.error('Satellite layer could not be updated:', err);
      }
    }
    // Infrared above true colour when both are on.
    if (want.ir && want.tc && map.getLayer(`${gibsIr.id}-layer`) && map.getLayer(`${gibsTrue.id}-layer`)) {
      map.moveLayer(`${gibsTrue.id}-layer`, `${gibsIr.id}-layer`);
    }
  };
  // Re-sync on a toggle, the opacity, or a newer image time from the clock.
  const gibsIrTiles = gibsIr.tiles[0];
  const gibsTrueTiles = gibsTrue.tiles[0];
  useEffect(() => {
    if (ready) syncGibsRef.current();
  }, [ready, layers.satIr, layers.satTrue, satOpacity, gibsIrTiles, gibsTrueTiles]);

  /** Fit a box (the 24 h ash drift, the tsunami warning areas) in the visible map, above the bottom dock. */
  const fitBox = useCallback(
    (points: readonly { lat: number; lon: number }[]) => {
      const map = mapRef.current;
      if (!map || points.length === 0) return;
      syncPadding();
      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const { w, h } = sizeRef.current;
      const visW = Math.max(0, w - padRef.current.left - padRef.current.right);
      const dock = rootRef.current?.querySelector<HTMLElement>('.mv-dock');
      const dockH = dock ? dock.offsetHeight + 24 : 0;
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        {
          padding: {
            top: Math.min(64, h / 6),
            bottom: Math.min(Math.max(48, dockH), h * 0.5),
            left: Math.min(48, visW / 6),
            right: Math.min(96, visW / 5),
          },
          duration: prefersReducedMotion() ? 0 : 1200,
          maxZoom: 9,
          essential: false,
          bearing: 0,
          pitch: 0,
        },
      );
    },
    [syncPadding],
  );

  // --- Map lifecycle ---------------------------------------------------------------------------

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
        style: darkRef.current ? STYLE_URLS.dark : STYLE_URLS.light,
        bounds: apacBounds(),
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
        maxPitch: 60,
        minZoom: 1.5,
        maxZoom: 19,
        locale: { 'Map.Title': MAP_LABEL },
      });
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
      return;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __aseanMap?: MapLibreMap }).__aseanMap = map;
    map.scrollZoom.setWheelZoomRate(1 / 300);
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true, customAttribution: CREDITS }), 'bottom-right');

    let timer: number | undefined;
    styleReadyRef.current = false;
    let offlineMode = false;
    let tilesOk = false;
    let tileErrors = 0;
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const goOffline = () => {
      if (offlineMode) return;
      offlineMode = true;
      clearTimer();
      setOffline(true);
      styleReadyRef.current = false;
      map.setStyle(buildOfflineStyle(getRegion(), darkRef.current), { diff: false });
    };
    const arm = () => {
      clearTimer();
      timer = window.setTimeout(() => {
        if (!styleReadyRef.current) goOffline();
      }, STYLE_TIMEOUT_MS);
    };
    retryStyleRef.current = () => {
      if (!offlineMode) return;
      offlineMode = false;
      setOffline(false);
      styleReadyRef.current = false;
      tilesOk = false;
      tileErrors = 0;
      map.setStyle(darkRef.current ? STYLE_URLS.dark : STYLE_URLS.light, { diff: false });
      arm();
    };
    const onOnline = () => retryStyleRef.current?.();
    window.addEventListener('online', onOnline);
    applyStyleRef.current = (isDark: boolean) => {
      styleReadyRef.current = false;
      tilesOk = false;
      tileErrors = 0;
      if (offlineMode) {
        map.setStyle(buildOfflineStyle(getRegion(), isDark), { diff: false });
        return;
      }
      map.setStyle(isDark ? STYLE_URLS.dark : STYLE_URLS.light, { diff: false });
      arm();
    };
    arm();

    map.on('style.load', () => {
      styleReadyRef.current = true;
      clearTimer();
      syncGibsRef.current();
      // Compact attribution starts collapsed on phones (the "i" button opens it).
      if (el.clientWidth <= NARROW_MAX) {
        el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      }
      const buildingSource = BUILDING_SOURCES.find((id) => map.getSource(id));
      if (offlineMode || !buildingSource || map.getLayer(BUILDINGS_LAYER)) return;
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: BUILDINGS_LAYER,
          type: 'fill-extrusion',
          source: buildingSource,
          'source-layer': 'building',
          minzoom: BUILDINGS_MIN_ZOOM,
          filter: ['!=', ['get', 'hide_3d'], true],
          layout: { visibility: buildingsRef.current ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': darkRef.current ? '#2b2f35' : '#d8d4cb',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              BUILDINGS_MIN_ZOOM,
              0,
              BUILDINGS_MIN_ZOOM + 0.6,
              ['coalesce', ['get', 'render_height'], 6],
            ],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': darkRef.current ? 0.85 : 0.72,
          },
        },
        firstSymbol,
      );
    });
    map.on('sourcedata', (e: MapSourceDataEvent) => {
      if (BUILDING_SOURCES.includes(e.sourceId) && e.tile) tilesOk = true;
    });
    map.on('error', (e) => {
      // Handled here, so MapLibre does not log it: a failed style goes offline at once; tiles after 3 failures with none loaded.
      if (offlineMode) return;
      if (!styleReadyRef.current) {
        goOffline();
        return;
      }
      const sourceId = (e as unknown as { sourceId?: string }).sourceId;
      if (!tilesOk && sourceId !== undefined && BUILDING_SOURCES.includes(sourceId)) {
        tileErrors += 1;
        if (tileErrors >= 3) goOffline();
      }
    });

    map.on('load', () => {
      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: deckLayersRef.current,
        getTooltip: (info: PickingInfo) => {
          const id = info.layer?.id ?? '';
          if (info.object && (id === 'mv-quakes-usgs' || id === 'mv-quakes-bmkg')) {
            return { text: quakeTooltip(info.object as QuakeEvent, USGS_TSUNAMI_FLAG_NOTE), className: 'mv-tooltip' };
          }
          if (info.object && id === 'mv-tide') {
            const st = info.object as SeaLevelStation;
            return { text: `Tide gauge ${st.name} (IOC ${st.code})\nRaw tide gauge data, not a tsunami warning (IOC/VLIZ)\nClick for the last 24 h`, className: 'mv-tooltip' };
          }
          const h = info.object as MapHotspot | undefined;
          if (!h || id !== 'mv-firms') return null;
          return {
            text: `NASA FIRMS hotspot (satellite)\n${h.confidenceLabel} · FRP ${formatValue(h.frp)} MW\n${formatUtc(h.observedAt)}`,
            className: 'mv-tooltip',
          };
        },
      });
      map.addControl(overlay as unknown as IControl);
      deckRef.current = overlay;
      try {
        const haze = new HazeLayerController(map);
        hazeRef.current = haze;
        if (hazeInputRef.current) haze.update(hazeInputRef.current);
      } catch (err) {
        console.error('Haze layer could not start:', err);
      }
      setReady(true);
    });

    map.on('move', positionOverlays);
    map.on('movestart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) setCity(null);
    });
    map.on('moveend', () => {
      positionOverlays();
      layoutTags();
      const s = windArrowStride(map.getZoom());
      setStride((prev) => (prev === s ? prev : s));
    });

    return () => {
      clearTimer();
      window.removeEventListener('online', onOnline);
      retryStyleRef.current = null;
      applyStyleRef.current = null;
      styleReadyRef.current = false;
      gibsDeferredRef.current = false;
      try {
        hazeRef.current?.destroy();
      } catch (err) {
        console.error('Haze layer could not be removed:', err);
      }
      hazeRef.current = null;
      deckRef.current = null;
      mapRef.current = null;
      setReady(false);
      map.remove();
    };
  }, [positionOverlays, layoutTags]);

  // Container size: narrow arrangement, padding, overlay bounds.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const onResize = () => {
      sizeRef.current = { w: root.clientWidth, h: root.clientHeight };
      const isNarrow = root.clientWidth <= NARROW_MAX;
      narrowRef.current = isNarrow;
      setNarrow((prev) => (prev === isNarrow ? prev : isNarrow));
      syncPadding();
      positionOverlays();
      layoutTags();
    };
    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(root);
    return () => observer.disconnect();
  }, [syncPadding, positionOverlays, layoutTags]);

  // When the overlay's content changes: register the positioned elements, place them and lay out tags.
  useLayoutEffect(() => {
    anchorsRef.current = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>('[data-lon]') ?? []);
    syncPadding();
    positionOverlays();
    layoutTags();
  }, [
    ready,
    placed,
    selectedId,
    layers,
    narrow,
    tight,
    warningMarkers,
    gaugeMarkers,
    rings,
    hazeRegions,
    driftCone,
    seaWindToward,
    tsunamiAreaMarkers.length,
    tsunamiObsMarkers.length,
    tsunamiWarning,
    riverShown,
    syncPadding,
    positionOverlays,
    layoutTags,
  ]);

  // The floating panels publish their widths through CSS custom properties that size the two probes:
  // follow them (open, close, resize) without re-running on every render.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const probes = [probeLRef.current, probeRRef.current].filter((p): p is HTMLSpanElement => p !== null);
    if (probes.length === 0) return;
    const observer = new ResizeObserver(() => {
      syncPadding();
      positionOverlays();
      layoutTags();
    });
    probes.forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, [syncPadding, positionOverlays, layoutTags]);

  // Selecting a watch area (map, list, hash) flies to it; clearing the selection returns to APAC.
  const fitKey = selectedIncident?.id ?? '';
  const firstFit = useRef(true);
  useEffect(() => {
    if (!ready) return;
    const animate = !firstFit.current || selectedIncident !== null;
    setCity(null);
    firstFit.current = false;
    fitTo(selectedIncident, animate);
    // Only a change of selection refits; free zoom and pan are left alone otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  const goHome = () => {
    setCity(null);
    if (selectedId !== null && onClearSelection) onClearSelection();
    else fitTo(null, true);
  };

  const toggleLayer = (key: keyof LayerToggles, on: boolean) => {
    setLayers((prev) => ({ ...prev, [key]: on }));
    if (key === 'buildings') {
      buildingsRef.current = on;
      const map = mapRef.current;
      if (map?.getLayer(BUILDINGS_LAYER)) {
        map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', on ? 'visible' : 'none');
        if (on && map.getZoom() >= BUILDINGS_MIN_ZOOM && map.getPitch() < 10) {
          map.easeTo({ pitch: 50, duration: prefersReducedMotion() ? 0 : 600 });
        }
      }
    }
  };

  const setBasemapDark = useCallback((on: boolean) => {
    if (darkRef.current === on) return;
    setDark(on);
    darkRef.current = on;
    applyStyleRef.current?.(on);
  }, []);

  // Follow the app theme: the prop when given, else the document's data-theme (set by the theme switcher).
  useEffect(() => {
    if (theme) {
      setBasemapDark(theme === 'dark');
      return;
    }
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setBasemapDark(resolveTheme(undefined) === 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [theme, setBasemapDark]);

  // --- Official markers: one tab stop, arrow keys move between the visible ones ----------------

  const warningsDrawn = layers.warnings ? warningMarkers : [];
  const gaugesDrawn = layers.warnings ? gaugeMarkers : [];
  const tsunamiBase = warningsDrawn.length + gaugesDrawn.length;
  const officialCount = tsunamiBase + tsunamiAreaMarkers.length + tsunamiObsMarkers.length;
  const officialTabStop = officialCount === 0 ? -1 : Math.min(officialActive, officialCount - 1);
  officialTabRef.current = officialTabStop;
  const focusOfficial = (from: number, step: number) => {
    const n = officialCount;
    for (let k = 1; k <= n; k++) {
      const i = (((from + step * k) % n) + n) % n;
      const el = officialRefs.current[i];
      if (el && el.dataset.off !== '1') {
        setOfficialActive(i);
        el.focus();
        return;
      }
    }
  };
  const onOfficialKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((event.target as HTMLElement).dataset.officialIndex ?? Number.NaN);
    if (!Number.isFinite(current)) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        focusOfficial(current, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        focusOfficial(current, -1);
        break;
      case 'Home':
      case 'Escape':
        focusOfficial(-1, 1);
        break;
      case 'End':
        focusOfficial(officialCount, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const officialProps = (index: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      officialRefs.current[index] = el;
    },
    tabIndex: index === officialTabStop ? 0 : -1,
    'data-official-index': index,
    onFocus: () => setOfficialActive(index),
  });
  officialRefs.current.length = officialCount;

  if (engineError) {
    return (
      <div className={className ? `map-view is-error ${className}` : 'map-view is-error'} role="alert">
        <p>
          <strong>The map engine could not start</strong> (WebGL may be unavailable). Use the watch-area list instead.
        </p>
        <p className="mv-muted">{engineError}</p>
      </div>
    );
  }

  const hasOfficial = layers.warnings && warningMarkers.some((w) => w.authority === 'official');
  const hasEstimate = layers.warnings && warningMarkers.some((w) => w.authority === 'aggregator');
  const hasGauge = layers.warnings && gaugeMarkers.length > 0;
  const selectedRest = selected ? locationRest(selected.name, selected.incident.locationName) : '';
  const chipText = neaShown && nea ? psiChipText(nea) : null;
  const modeLabel = nea?.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT';
  const tsunamiIssued = tsunamiWarning?.issuedAt ? formatUtc(tsunamiWarning.issuedAt) : 'issue time not given';
  /** In force: LIVE or SNAPSHOT plus the issue time. History: HISTORICAL with the real ended state. */
  const tsunamiStatus = !tsunamiWarning
    ? ''
    : tsunamiInForce
      ? `${tsunamiWarning.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT'} · issued ${tsunamiIssued}`
      : `HISTORICAL · ${tsunamiIssued} · ${isExpired(tsunamiWarning, nowMs) ? 'ended' : 'not ended'}`;
  const ashModeLabel = ashWind?.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT';
  const ashDirections = ashDrift
    ? ashDrift.tracks
        .map((t) => `${t.label} toward ${t.bearingDeg === null ? 'nowhere (calm)' : compass16(t.bearingDeg)}, ${Math.round(t.distanceKm)} km`)
        .join(' · ')
    : '';
  const showTsunamiHistory = (checked: boolean) => {
    setTsunamiHistory(checked);
    const latest = tsunamiPick.latest;
    if (!checked || !latest) return;
    if (!layers.tsunami) setLayers((prev) => ({ ...prev, tsunami: true }));
    const pts = [...placeTsunamiAreas(latest.areas, idnDistrictIndex()).placed, ...(latest.observations ?? [])];
    // After the panel renders, so the fit keeps clear of it.
    window.setTimeout(() => fitBox(pts), 60);
  };

  const legendBody = (
    <>
      <div className="mv-legend-grid">
        <ul className="mv-legend-list">
          {LEGEND_STATES.map((state) => (
            <li key={state} className={`mv-legend-item ${stateClass(state)}`}>
              <svg className="mv-swatch" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <MarkerSymbol hazard={null} state={state} />
              </svg>
              <span>{STATE_LABEL[state]}</span>
            </li>
          ))}
        </ul>
        {(hasOfficial ||
          hasEstimate ||
          hasGauge ||
          hotspotsShown.length > 0 ||
          transportShown ||
          ashShown ||
          tsunamiAreaMarkers.length > 0 ||
          tsunamiObsMarkers.length > 0 ||
          quakesShown.length > 0 ||
          tideShown.length > 0) && (
          <ul className="mv-legend-list is-official">
            {hasOfficial && (
              <li className="mv-legend-item">
                <svg className="mv-swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="official" />
                </svg>
                <span>
                  Official warning <span className="mv-legend-sub">(issuer)</span>
                </span>
              </li>
            )}
            {hasEstimate && (
              <li className="mv-legend-item">
                <svg className="mv-swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="estimate" />
                </svg>
                <span>
                  Impact estimate <span className="mv-legend-sub">(GDACS)</span>
                </span>
              </li>
            )}
            {hasGauge && (
              <li className="mv-legend-item">
                <svg className="mv-swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="gauge" />
                </svg>
                <span>
                  Water-level gauge <span className="mv-legend-sub">(issuer)</span>
                </span>
              </li>
            )}
            {hotspotsShown.length > 0 && (
              <li className="mv-legend-item">
                <span className="mv-dot-swatch" aria-hidden="true" />
                <span>
                  Hotspot <span className="mv-legend-sub">(NASA FIRMS)</span>
                </span>
              </li>
            )}
            {tsunamiAreaMarkers.length > 0 && (
              <li className="mv-legend-item">
                <svg className="mv-swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind={tsunamiWarning && isExpired(tsunamiWarning, nowMs) ? 'ended' : 'official'} />
                </svg>
                <span>
                  Tsunami warning area <span className="mv-legend-sub">(BMKG, district centre)</span>
                </span>
              </li>
            )}
            {tsunamiObsMarkers.length > 0 && (
              <li className="mv-legend-item">
                <svg className="mv-swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="gauge" />
                </svg>
                <span>
                  Observed tsunami height <span className="mv-legend-sub">(BMKG gauge)</span>
                </span>
              </li>
            )}
            {quakesShown.length > 0 && (
              <li className="mv-legend-item">
                <span className="mv-quake-swatch" aria-hidden="true" />
                <span>
                  Earthquake <span className="mv-legend-sub">(USGS disc, BMKG ring; depth: amber shallow, teal mid, violet deep)</span>
                </span>
              </li>
            )}
            {tideShown.length > 0 && (
              <li className="mv-legend-item">
                <span className="mv-tide-swatch" aria-hidden="true" />
                <span>
                  Tide gauge <span className="mv-legend-sub">(IOC, raw)</span>
                </span>
              </li>
            )}
            {ashShown && (
              <li className="mv-legend-item">
                <span className="mv-ash-swatch" aria-hidden="true" />
                <span>
                  Ash drift <span className="mv-legend-sub">(modelled, ~3 / 5.5 / 9 km)</span>
                </span>
              </li>
            )}
            {transportShown && (
              <li className="mv-legend-item">
                <span className="mv-path-swatch" aria-hidden="true" />
                <span>
                  Haze path <span className="mv-legend-sub">(modelled)</span>
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
      <p className="mv-legend-note">Workflow states, not official alert levels</p>
      {nea && layers.nea && (
        <p className="mv-legend-nea">
          <NeaSwatch kind={neaShown ? 'both' : 'wind'} variable={windVariable} />
          <span>Wind &amp; haze: NEA Singapore</span>
        </p>
      )}
      <div className="mv-layers" role="group" aria-labelledby={layersTitleId}>
        <span id={layersTitleId} className="mv-layers-title">
          Layers
        </span>
        <fieldset className="mv-layer-group">
          <legend>Watch</legend>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.watch} onChange={(e) => toggleLayer('watch', e.currentTarget.checked)} />
            <span>Watch areas</span>
          </label>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.rings} onChange={(e) => toggleLayer('rings', e.currentTarget.checked)} />
            <span>Distance rings</span>
          </label>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.quakes} onChange={(e) => toggleLayer('quakes', e.currentTarget.checked)} />
            <span>Earthquakes (USGS, BMKG)</span>
          </label>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.nea} onChange={(e) => toggleLayer('nea', e.currentTarget.checked)} />
            <span>NEA wind and haze</span>
          </label>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.tide} onChange={(e) => toggleLayer('tide', e.currentTarget.checked)} />
            <span>Tide gauges (IOC)</span>
          </label>
        </fieldset>
        <fieldset className="mv-layer-group">
          <legend>Official</legend>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.warnings} onChange={(e) => toggleLayer('warnings', e.currentTarget.checked)} />
            <span>Official warnings</span>
          </label>
          {tsunamiPick.latest && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.tsunami} onChange={(e) => toggleLayer('tsunami', e.currentTarget.checked)} />
              <span>Official tsunami areas (BMKG)</span>
            </label>
          )}
          {tsunamiPick.latest && !tsunamiInForce && (
            <label className="mv-layer mv-layer-sub">
              <input type="checkbox" role="switch" checked={tsunamiHistory} onChange={(e) => showTsunamiHistory(e.currentTarget.checked)} />
              <span>History: last BMKG tsunami warning</span>
            </label>
          )}
        </fieldset>
        <fieldset className="mv-layer-group">
          <legend>Modelled</legend>
          {ashDrift && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.ash} onChange={(e) => toggleLayer('ash', e.currentTarget.checked)} />
              <span>Ash drift (modelled)</span>
            </label>
          )}
          {transport && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.transport} onChange={(e) => toggleLayer('transport', e.currentTarget.checked)} />
              <span>Haze transport (modelled)</span>
            </label>
          )}
          {windGrid && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.particles} onChange={(e) => toggleLayer('particles', e.currentTarget.checked)} />
              <span>Wind particles (modelled, 925 hPa)</span>
            </label>
          )}
          {airQuality != null && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.haze} onChange={(e) => toggleLayer('haze', e.currentTarget.checked)} />
              <span>Haze (modelled PM2.5, CAMS)</span>
            </label>
          )}
          {riverFlow && riverFlow.length > 0 && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.river} onChange={(e) => toggleLayer('river', e.currentTarget.checked)} />
              <span>River flow (modelled)</span>
            </label>
          )}
        </fieldset>
        <fieldset className="mv-layer-group">
          <legend>Imagery</legend>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.satIr} onChange={(e) => toggleLayer('satIr', e.currentTarget.checked)} />
            <span>Satellite: Himawari-9 infrared (~10 min, ~45 min delay)</span>
          </label>
          <label className="mv-layer">
            <input type="checkbox" checked={layers.satTrue} onChange={(e) => toggleLayer('satTrue', e.currentTarget.checked)} />
            <span>Satellite: true colour (yesterday)</span>
          </label>
          {(layers.satIr || layers.satTrue) && (
            <label className="mv-layer mv-layer-range">
              <span>Imagery opacity</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={satOpacity}
                onChange={(e) => setSatOpacity(Number(e.currentTarget.value))}
                aria-valuetext={`${Math.round(satOpacity * 100)} %`}
              />
            </label>
          )}
          {!offline && (
            <label className="mv-layer">
              <input type="checkbox" checked={layers.buildings} onChange={(e) => toggleLayer('buildings', e.currentTarget.checked)} />
              <span>3D buildings</span>
            </label>
          )}
          <label className="mv-layer">
            <input type="checkbox" checked={!dark} onChange={(e) => setBasemapDark(!e.currentTarget.checked)} />
            <span>Light map</span>
          </label>
        </fieldset>
      </div>
      {offline && (
        <p className="mv-legend-note">
          Offline map: street tiles unavailable, showing bundled country outlines.{' '}
          <button type="button" className="mv-linkbtn" onClick={() => retryStyleRef.current?.()}>
            Retry map
          </button>
        </p>
      )}
    </>
  );


  // Captions: official first, then the safety caption of the selection, then the rest. At most two show
  // (one on phones); the others fold into a "Notes (n)" chip so the map stays visible at 1366x680.
  const notes: { key: string; card?: boolean; node: ReactNode }[] = [];
  if (tsunamiShown && tsunamiWarning && tsunamiPlacement) {
    notes.push({
      key: 'tsunami',
      card: true,
      node: (
          <div className="mv-caption mv-tsunami" role="group" aria-label="Official BMKG InaTEWS tsunami warning areas">
            <p className="mv-tsunami-head">
              <span className={`mv-mode ${tsunamiInForce && tsunamiWarning.dataMode === 'live' ? 'is-live' : 'is-historical'}`}>{tsunamiStatus}</span>{' '}
              <span lang="id">{tsunamiWarning.product}</span>
            </p>
            <p>
              <span className="mv-caption-key">
                Official BMKG InaTEWS warning areas, relayed verbatim. Positions are district centres (approximate). Follow BMKG&apos;s
                instructions.
              </span>{' '}
              <a href={tsunamiWarning.issuerUrl} target="_blank" rel="noopener noreferrer">
                BMKG InaTEWS <span aria-hidden="true">↗</span>
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </p>
            <p className="mv-tsunami-meta">
              {tsunamiPlacement.placed.length} of {tsunamiWarning.areas.length} areas placed
              {tsunamiObsMarkers.length > 0 ? ` · ${tsunamiObsMarkers.length} observed heights (BMKG tide gauges)` : ''}
              {onSelectWarning && (
                <>
                  {' · '}
                  <button type="button" className="mv-linkbtn" onClick={() => onSelectWarning(tsunamiWarning.id)}>
                    Open the BMKG message
                  </button>
                </>
              )}
            </p>
            {tsunamiPlacement.unplaced.length > 0 && (
              <details className="mv-tsunami-unplaced">
                <summary>Not placed on map ({tsunamiPlacement.unplaced.length})</summary>
                <ul>
                  {tsunamiPlacement.unplaced.map((u, i) => (
                    <li key={`${u.area.name}-${i}`}>
                      <span lang="id">
                        {u.area.name}
                        {u.area.province ? `, ${u.area.province}` : ''} · <strong>{u.area.level ?? 'No level given'}</strong>
                      </span>
                      <span className="mv-tsunami-why"> · {u.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
      ),
    });
  }
  if (ashShown && ashDrift) {
    notes.push({
      key: 'ash',
      node: (
              <p className="mv-caption-ash">
                <span className="mv-caption-key">
                  Where ash would drift with current forecast winds at three heights (Open-Meteo, MODELLED). Illustrative, not an ash
                  advisory or hazard zone. Official:{' '}
                  <a href={MAGMA_URL} target="_blank" rel="noopener noreferrer">
                    PVMBG (MAGMA)
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>{' '}
                  and{' '}
                  <a href={VAAC_DARWIN_URL} target="_blank" rel="noopener noreferrer">
                    VAAC Darwin
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                  .
                </span>{' '}
                <span>Simplified: uses the forecast wind at the summit for the whole path.</span>{' '}
                <span className="mv-caption-meta">
                  {ashModeLabel} · 24 h from <time dateTime={ashDrift.startISO}>{formatUtc(ashDrift.startISO)}</time>, dots at 3, 6,
                  12 and 24 h. {ashDirections}.
                </span>{' '}
                <button type="button" className="mv-linkbtn" onClick={() => fitBox(ashDrift.tracks.flatMap((t) => t.points))}>
                  Show the 24 h drift
                </button>
              </p>
      ),
    });
  }
  if (rings) {
    notes.push({
      key: 'rings',
      node: (
              <p>
                <span className="mv-caption-key">Distance from summit (reference), not an official hazard zone.</span>{' '}
                <a href={MAGMA_URL} target="_blank" rel="noopener noreferrer">
                  Official danger zone and recommendations: PVMBG / MAGMA <span aria-hidden="true">↗</span>
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </p>
      ),
    });
  }
  for (const g of gibsShown) {
    notes.push({
      key: g.id,
      node: (
        <p>
          <span className="mv-caption-key">Satellite imagery: {g.title}</span>{' '}
          <span className="mv-caption-meta">
            {g.timeISO.length > 10 ? `${formatUtc(g.timeISO)}` : `${g.timeISO} (UTC day)`}. {g.latencyNote} NASA GIBS.
          </span>
        </p>
      ),
    });
  }
  if (layers.quakes && quakes) {
    // Mode and retrieval time from the quake statuses; no "last 24 h" count when no source is live.
    const caption = quakeCaption(quakes.statuses, quakesShown, nowMs);
    notes.push({
      key: 'quakes',
      node: (
        <p>
          <span className="mv-caption-key">{caption.key}</span> <span className="mv-caption-meta">{caption.meta}</span>
        </p>
      ),
    });
  }
  if (tideShown.length > 0) {
    notes.push({
      key: 'tide',
      node: (
        <p>
          <span className="mv-caption-key">Raw tide gauge data, not a tsunami warning (IOC/VLIZ).</span>{' '}
          <span className="mv-caption-meta">{tideShown.length} stations; click one for its last 24 h.</span>
        </p>
      ),
    });
  }
  if (riverShown.length > 0) {
    notes.push({
      key: 'river',
      node: (
        <p>
          <span className="mv-caption-key">River flow: MODELLED (GloFAS via Open-Meteo), not a flood warning.</span>{' '}
          <span className="mv-caption-meta">Click a river point for its 15-day modelled discharge.</span>
        </p>
      ),
    });
  }
  if (hotspotsShown.length > 0) {
    notes.push({
      key: 'firms',
      node: (
              <p className="mv-caption-firms">
                <span className="mv-caption-key">NASA FIRMS hotspots:</span>{' '}
                <span className="mv-caption-meta">
                  {hotspotsToday} on this replay day (filled), {hotspotsShown.length - hotspotsToday} earlier (faded); satellite
                  detections, not confirmed fires
                </span>
              </p>
      ),
    });
  }
  if (transportShown && transport) {
    notes.push({
      key: 'transport',
      node: (
              <>
                <p>
                  <span className="mv-caption-key">
                    MODELLED wind (Open-Meteo, {transport.level}) · illustrative haze paths, not a dispersion model
                  </span>{' '}
                  <span className="mv-caption-meta">
                    {transport.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT'} · from{' '}
                    <time dateTime={transport.time}>{formatUtc(transport.time)}</time>, dots every 12 h
                  </span>
                </p>
                {transport.summary && !rings && <p className="mv-caption-summary">{transport.summary}</p>}
              </>
      ),
    });
  }
  const stackedNotes = stackNotes(notes, narrow ? 1 : 2);

  return (
    <div ref={rootRef} className={`map-view${dark ? ' is-dark' : ' is-light'}${narrow ? ' is-narrow' : ''}${tight ? ' is-tight' : ''}${className ? ` ${className}` : ''}`}>
      <div ref={mapElRef} className="mv-map" />
      <span ref={probeLRef} className="mv-probe is-left" aria-hidden="true" />
      <span ref={probeRRef} className="mv-probe is-right" aria-hidden="true" />

      <div ref={overlayRef} className="mv-overlay" data-ready={ready ? 'true' : 'false'} data-near="false">
        {rings?.map((r) => (
          <span key={r.km} className="mv-ring-label" data-lon={r.label[0]} data-lat={r.label[1]} aria-hidden="true">
            {r.km} km
          </span>
        ))}
        {hazeRegions?.regions.map((h) => (
          <span key={h.region} className="mv-haze-label mv-near-only" data-lon={h.lon} data-lat={h.lat}>
            {h.region === 'central'
              ? `PSI ${h.psi} · ${h.band} · NEA ${hazeRegions.mode} ${hazeRegions.time} UTC`
              : `${h.region[0].toUpperCase()}${h.region.slice(1)} ${h.psi}`}
          </span>
        ))}
        {nea && seaWindToward !== null && (
          <span
            className="mv-wind-label mv-near-only"
            data-lon={SINGAPORE[0]}
            data-lat={SINGAPORE[1]}
          >
            Wind {windLine(nea)} · NEA stations
          </span>
        )}
        {driftCone && (
          <span className="mv-drift-label" data-lon={driftCone.label[0]} data-lat={driftCone.label[1]}>
            Illustrative drift, not a dispersion model
          </span>
        )}

        {officialCount > 0 && (
          <div
            className="mv-official-layer"
            role="group"
            aria-label="Official warnings and water-level gauges on the map (arrow keys to move between them)"
            onKeyDown={onOfficialKeyDown}
          >
            {warningsDrawn.map((w, i) => {
              const official = w.authority === 'official';
              const isSelected = w.id === selectedWarningId;
              const area = w.areaDescription.trim() || w.headline.trim();
              const label = official
                ? `Official warning: ${w.issuer} · ${w.level} · ${area}`
                : `Impact estimate (GDACS, not a warning): ${w.issuer} · ${w.level} · ${area}`;
              const ended = endedLabel(w, nowMs);
              const kind: OfficialKind = !official ? 'estimate' : ended ? 'ended' : 'official';
              const loc = w.location as { lat: number; lon: number };
              return (
                <button
                  key={`${w.id}-${i}`}
                  type="button"
                  className={`mv-wmarker is-${kind}${isSelected ? ' is-selected' : ''}`}
                  data-lon={loc.lon}
                  data-lat={loc.lat}
                  aria-label={label}
                  aria-pressed={isSelected}
                  onClick={onSelectWarning ? () => onSelectWarning(w.id) : undefined}
                  {...officialProps(i)}
                >
                  <svg className="mv-wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <OfficialSymbol kind={kind} selected={isSelected} />
                  </svg>
                  <span className="mv-wcallout" aria-hidden="true">
                    <strong>{w.issuer}</strong>
                    <span lang={w.language || undefined}>{w.level}</span>
                    {ended && (
                      <span className="mv-wcallout-meta">{ended.text === 'EXPIRED' ? `Expired ${formatUtc(ended.at)}` : 'Ended'}</span>
                    )}
                    {!official && <span className="mv-wcallout-meta">Impact estimate, not a warning</span>}
                    {w.issuer.startsWith('Pacific Tsunami Warning Center') && (
                      <span className="mv-wcallout-meta" title={PTWC_NATIONAL_AUTHORITIES_NOTE}>
                        For national authorities; follow your national agency
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {gaugesDrawn.map((g, i) => {
              const reading = `${formatValue(g.value)} ${g.unit} (${g.datum})`;
              const label = `Water level: ${g.name} · ${reading}${g.situation ? ` · ${g.situation}` : ''} · ${g.issuer}`;
              const cited = warningMarkers.find((w) => warningMatchesGauge(w.id, g.id));
              const isSelected = cited !== undefined && cited.id === selectedWarningId;
              return (
                <button
                  key={`${g.id}-${i}`}
                  type="button"
                  className={`mv-wmarker is-gauge${isSelected ? ' is-selected' : ''}`}
                  data-lon={g.lon}
                  data-lat={g.lat}
                  aria-label={label}
                  aria-pressed={cited ? isSelected : undefined}
                  onClick={onSelectWarning && cited ? () => onSelectWarning(cited.id) : undefined}
                  {...officialProps(warningsDrawn.length + i)}
                >
                  <svg className="mv-wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <OfficialSymbol kind="gauge" selected={isSelected} />
                  </svg>
                  <span className="mv-wcallout" aria-hidden="true">
                    <strong>{g.issuer}</strong>
                    <span className="mono">
                      {g.name} · {reading}
                    </span>
                    {g.situation && <span lang={issuerLang(g.issuer)}>{g.situation}</span>}
                  </span>
                </button>
              );
            })}
            {tsunamiWarning &&
              tsunamiAreaMarkers.map((a, i) => {
                const isSelected = tsunamiWarning.id === selectedWarningId;
                const level = a.area.level ?? 'No level given';
                // BMKG's own instruction line for this level, verbatim (no gloss or numbers of ours).
                const instruction = bmkgLevelInstruction(tsunamiWarning, a.area.level);
                const place = `${a.area.name}${a.area.province ? `, ${a.area.province}` : ''}`;
                const kind: OfficialKind = isExpired(tsunamiWarning, nowMs) ? 'ended' : 'official';
                return (
                  <button
                    key={`ta-${a.area.name}-${i}`}
                    type="button"
                    className={`mv-wmarker mv-tarea is-${kind}${isSelected ? ' is-selected' : ''}`}
                    data-lon={a.lon}
                    data-lat={a.lat}
                    aria-label={`Official tsunami warning area (BMKG InaTEWS): ${place} · ${level}${instruction ? ` · BMKG's instruction for this level: ${instruction}` : ''} · ${tsunamiStatus} · position approximate, ${a.note}`}
                    aria-pressed={isSelected}
                    onClick={onSelectWarning ? () => onSelectWarning(tsunamiWarning.id) : undefined}
                    {...officialProps(tsunamiBase + i)}
                  >
                    <svg className="mv-wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <OfficialSymbol kind={kind} selected={isSelected} />
                    </svg>
                    <span className="mv-tarea-level" lang="id" aria-hidden="true">
                      {level}
                    </span>
                    <span className="mv-wcallout" aria-hidden="true">
                      <strong>BMKG InaTEWS</strong>
                      <span lang="id">{place}</span>
                      <strong lang="id">{level}</strong>
                      {instruction ? (
                        <>
                          <span className="mv-wcallout-meta">BMKG&apos;s instruction for this level:</span>
                          <span lang="id">{instruction}</span>
                        </>
                      ) : (
                        <span className="mv-wcallout-meta">See BMKG for level definitions</span>
                      )}
                      <span className="mv-wcallout-meta">{tsunamiStatus}</span>
                      <span className="mv-wcallout-meta">Position: {a.note}</span>
                    </span>
                  </button>
                );
              })}
            {tsunamiWarning &&
              tsunamiObsMarkers.map((o, i) => {
                const isSelected = tsunamiWarning.id === selectedWarningId;
                const when = o.observedAt ? formatUtc(o.observedAt) : (o.timeText ?? 'time not given');
                const text = `Observed ${o.heightText} m at ${o.location} ${when} (BMKG)`;
                return (
                  <button
                    key={`to-${o.location}-${i}`}
                    type="button"
                    className={`mv-wmarker mv-tobs is-gauge${isSelected ? ' is-selected' : ''}`}
                    data-lon={o.lon}
                    data-lat={o.lat}
                    aria-label={`${text}, tide gauge reading relayed from BMKG InaTEWS`}
                    aria-pressed={isSelected}
                    onClick={onSelectWarning ? () => onSelectWarning(tsunamiWarning.id) : undefined}
                    {...officialProps(tsunamiBase + tsunamiAreaMarkers.length + i)}
                  >
                    <svg className="mv-wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <OfficialSymbol kind="gauge" selected={isSelected} />
                    </svg>
                    <span className="mv-wcallout" aria-hidden="true">
                      <span lang="id">{text}</span>
                      <span className="mv-wcallout-meta">{tsunamiStatus}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {riverShown.map((r) => (
          <button
            key={r.pointId}
            type="button"
            className={`mv-river${chart?.kind === 'river' && chart.id === r.pointId ? ' is-selected' : ''}`}
            data-lon={r.requested.lon}
            data-lat={r.requested.lat}
            aria-label={`${r.river} at ${r.place}: modelled river flow (GloFAS via Open-Meteo), not a flood warning`}
            onClick={(e) => {
              const box = rootRef.current?.getBoundingClientRect();
              const b = e.currentTarget.getBoundingClientRect();
              setChart({ kind: 'river', id: r.pointId, at: { x: b.left + b.width / 2 - (box?.left ?? 0), y: b.top + b.height / 2 - (box?.top ?? 0) } });
            }}
          >
            <span className="mv-river-dot" aria-hidden="true" />
            <span className="mv-river-tag" aria-hidden="true">
              {r.river} <span className="mv-river-sub">modelled</span>
            </span>
          </button>
        ))}

        {layers.watch &&
          placed.map((p) => {
            const isSelected = p.incident.id === selectedId;
            return (
              <button
                key={p.incident.id}
                type="button"
                className={`mv-marker ${stateClass(p.state)}${isSelected ? ' is-selected' : ''}`}
                data-lon={p.incident.lon}
                data-lat={p.incident.lat}
                aria-label={`${p.incident.title} — ${p.stateLabel}`}
                aria-pressed={isSelected}
                aria-describedby={isSelected ? calloutId : undefined}
                onClick={() => {
                  if (isSelected) fitTo(p.incident, true);
                  onSelect(p.incident.id);
                }}
              >
                <svg className="mv-symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                  <MarkerSymbol hazard={p.incident.hazard} state={p.state} selected={isSelected} />
                </svg>
                {isSelected ? (
                  <span id={calloutId} className={`mv-tag mv-callout ${stateClass(p.state)}`}>
                    <span className="mv-callout-title">
                      <strong>{p.name}</strong>
                      {!narrow && selectedRest && <> · {selectedRest}</>}
                    </span>
                    {!narrow && (
                      <span className="mv-callout-coords mono">
                        <span>{formatCoordinate(p.incident.lat, 'N', 'S')},</span>{' '}
                        <span>{formatCoordinate(p.incident.lon, 'E', 'W')}</span>
                      </span>
                    )}
                    <span className="mv-callout-state">{p.stateLabel}</span>
                  </span>
                ) : (
                  <span className="mv-tag" aria-hidden="true">
                    <span className="mv-tag-name">{p.name}</span>
                    {!narrow && <span className="mv-tag-state"> · {p.stateLabel}</span>}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {/* Legend and layer toggles: one disclosure, open by default on wide maps, closed on phones. */}
      <details
        key={narrow ? 'narrow' : tight ? 'tight' : 'wide'}
        className={narrow ? 'mv-compact' : 'mv-compact is-wide'}
        open={!narrow && !tight}
      >
        <summary className="mv-compact-summary">Legend and layers</summary>
        <div className="mv-legend is-inline" role="group" aria-label="Map legend and layers">
          {legendBody}
        </div>
      </details>

      {neaShown && nea && drift && (
        <div className="mv-nea" title={nea.attribution}>
          <p className="mv-nea-source">
            <span>{narrow ? 'NEA Singapore' : 'Wind: NEA Singapore stations'}</span>{' '}
            <span className={`mv-mode is-${nea.dataMode}`}>{modeLabel}</span>{' '}
            <time dateTime={nea.observedAt}>{formatUtc(nea.observedAt)}</time>
          </p>
          <p className={`mv-nea-row${downwindDeg !== null ? '' : ' is-unavailable'}`}>
            {downwindDeg !== null && <NeaSwatch kind="wind" variable={windVariable} />}
            <span>{downwindDeg !== null ? windLine(nea) : 'Wind direction unavailable'}</span>
          </p>
          {downwindDeg !== null && (
            <p className="mv-nea-row">
              <NeaSwatch kind="drift" />
              <span>
                {narrow
                  ? 'Illustrative drift, not a dispersion model'
                  : `Singapore wind applied to the ${selected?.name ?? 'watch'} hotspot area, ${Math.round(drift.distanceKm)} km away. Illustrative drift, not a dispersion model.`}
              </span>
            </p>
          )}
          {chipText && (
            <p className="mv-nea-row mono" title={nea.haze ? `NEA PSI reading ${formatUtc(nea.haze.observedAt)}` : undefined}>
              {chipText}
            </p>
          )}
        </div>
      )}

      <button type="button" className="mv-home" title="Back to the regional view" onClick={goHome}>
        All APAC
      </button>

      {chart?.kind === 'tide' &&
        layers.tide &&
        (() => {
          const st = tideStations.find((t) => t.code === chart.id);
          return st ? <TideGaugePopover station={st} anchor={chart.at} dark={dark} onClose={() => setChart(null)} /> : null;
        })()}
      {chart?.kind === 'river' &&
        layers.river &&
        (() => {
          const r = riverFlow?.find((x) => x.pointId === chart.id);
          return r ? <RiverFlowPopover series={r} anchor={chart.at} dark={dark} onClose={() => setChart(null)} /> : null;
        })()}

      {city && airQuality && hazeHour && layers.haze && (
        <CityPopover
          cityId={city.id}
          airQuality={airQuality}
          timeISO={hazeHour.timeISO}
          nowISO={hazeHour.steps.times[hazeHour.steps.nowIndex] ?? hazeHour.timeISO}
          neaHaze={layers.nea ? (nea?.haze ?? null) : null}
          anchor={city.at}
          dark={dark}
          onClose={() => setCity(null)}
        />
      )}

      <div className="mv-dock">
        {airQuality && hazeHour && (layers.haze || layers.particles) && (
          // Phones: the forecast scrubber folds into a disclosure so it never covers the whole map.
          <details key={narrow ? 'narrow' : 'wide'} className="mv-scrub-box" open={!narrow}>
            <summary className="mv-scrub-summary">Haze forecast (modelled)</summary>
            <HazeScrubber
              className="mv-scrubber"
              steps={hazeHour.steps}
              index={hazeHour.index}
              onIndexChange={hazeHour.setIndex}
              airQuality={airQuality}
              dark={dark}
            />
          </details>
        )}
        {stackedNotes.visible.map((n) => (n.card ? <div key={n.key}>{n.node}</div> : null))}
        {stackedNotes.visible.some((n) => !n.card) && (
          <div className="mv-caption">
            {stackedNotes.visible.map((n) => (n.card ? null : <div key={n.key}>{n.node}</div>))}
          </div>
        )}
        {stackedNotes.hidden.length > 0 && (
          <details className="mv-caption mv-notes">
            <summary>Notes ({stackedNotes.hidden.length})</summary>
            {stackedNotes.hidden.map((n) => (
              <div key={n.key} className={n.card ? 'mv-notes-card' : undefined}>
                {n.node}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
