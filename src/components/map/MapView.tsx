// Map mode (docs/UX_V3.md section 2) on MapLibre GL JS + deck.gl. Calm on purpose: the map, six layer chips
// and one forecast scrubber at the bottom, and one card slot for whatever is selected. Every other layer is
// toggled from the workspace Layers section; App owns the toggles (layerCatalog.ts is the one list).
//
// - Basemap per theme from basemap.ts (CARTO Dark Matter / Positron with light tweaks); a bundled Natural
//   Earth style takes over when the network style fails, so the map still draws offline.
// - Map overlay colours come from mapPalette.ts (getMapPalette(theme)); UI chrome uses the CSS tokens.
// - Geographic layers (rings, ash drift, haze paths, hotspots, quakes, tide gauges, NEA context) are deck.gl
//   layers on one MapboxOverlay. Teammates' layers plug in through `extraLayers` (fire heat grid) and
//   `scenarioLayers` (the "If it erupted now" ash plume); until those land, interim layers draw the
//   snapshot hotspots and a growing ash-drift plume.
// - Interactive markers (volcano triangles ringed in the official level colour, official warning pins,
//   gauges, river points) are React buttons in an HTML overlay; a "move" listener writes their transforms
//   directly, so panning never re-renders React.
// - The modelled haze, wind particles and city circles belong to HazeLayerController (its own overlay).
// - The shell publishes --overlay-left / --overlay-right / --overlay-top on .map-panel (drawer, card, top
//   bar); with the dock height they become the camera padding, so fly-to centres in the visible map.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { IControl, LngLatBoundsLike, MapSourceDataEvent, RasterTileSource } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import regionRaw from '../../../data/region.geojson?raw';
import type { DriftAssessment, Incident, NeaContext, OfficialWarning, QuakeEvent, ReviewState, RiverDischargeSeries, SeaLevelStation } from '../../types';
import type { GaugeReading } from '../../lib/warnings';
import { bmkgLevelInstruction } from '../../lib/warnings';
import { ashDriftTracks } from '../../lib/ashDrift';
import type { AshLevel, AshWindData, DriftTrack } from '../../lib/ashDrift';
import { GEOBOUNDARIES_ATTRIBUTION, idnDistrictIndex, placeTsunamiAreas, selectTsunamiAreaWarnings } from '../../lib/tsunamiAreas';
import type { WindGrid } from '../../lib/windField';
import { USGS_TSUNAMI_FLAG_NOTE } from '../../lib/quakesLive';
import type { QuakesResult } from '../../lib/quakesLive';
import { loadSeaLevelStations } from '../../lib/seaLevel';
import { himawariIrLayer, trueColourLayer } from '../../lib/gibs';
import { psiBand } from '../../lib/nea';
import { PTWC_NATIONAL_AUTHORITIES_NOTE } from '../../lib/ptwc';
import { isRecentQuake, quakeDepthBand, quakeRadiusPx, quakeTooltip } from './connectorRender';
import { RiverFlowPopover, TideGaugePopover } from './ChartPopover';
import { HAZE_ATTRIBUTION, HazeLayerController } from './HazeLayerController';
import type { AirQualityData, HazeCity, HazeLayerInput } from './HazeLayerController';
import HazeScrubber from './HazeScrubber';
import type { HazeHour } from './useHazeHour';
import { getMapPalette, rgbCss, volcanoLevelColour } from './mapPalette';
import type { Rgb, Rgba } from './mapPalette';
import { BASEMAP_BUILDING_SOURCES, basemapStyleFor, basemapStyleOptions, buildingPaint } from './basemap';
import { LAYER_CATALOG, MAP_CHIPS } from './layerCatalog';
import type { LayerKey, MapLayerState } from './layerCatalog';
import type { OfficialVolcanoLevel } from './volcanoLevels';
import type { MapSelection } from '../shell/workspace';
import ErrorBoundary from '../ErrorBoundary';
import { FireIcon, HazeIcon, LayersIcon, VolcanoIcon, WarningIcon } from '../shell/icons';
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
import { isExpired, warningMatchesGauge } from '../../lib/warningsView';
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

/** What a teammate's layer builder gets: the theme, the scrubber hour and a coarse zoom. */
export interface MapLayerContext {
  theme: 'dark' | 'light';
  /** The scrubber's hour (ISO 8601 UTC), or '' before the forecast loads. */
  timeISO: string;
  /** Map zoom rounded to 0.5 (clustering thresholds). */
  zoom: number;
  selection: MapSelection | null;
}

export interface MapViewProps {
  incidents: Incident[];
  /** Our workflow state per watch id (workspace material; only used for marker titles). */
  states?: Record<string, ReviewState>;
  /** Short place name per watch id (e.g. "Merapi"). */
  placeNames?: Record<string, string>;
  selection: MapSelection | null;
  onSelect: (selection: MapSelection | null) => void;
  layers: MapLayerState;
  onLayersChange: (patch: Partial<MapLayerState>) => void;
  /** Opens the workspace Layers section (the "More layers" button). */
  onOpenLayers?: () => void;
  /** The card for the selection (from MapCards), shown in the card slot. */
  card?: ReactNode;
  /** Official activity level per volcano watch id (verbatim; the ring colour follows the issuer's scale). */
  levels?: Record<string, OfficialVolcanoLevel | null>;
  /** NEA Singapore context (live or bundled snapshot): PSI shading and the station wind arrow. */
  nea?: NeaContext | null;
  /** Drift assessment for the selected haze watch: the illustrative drift cone (NEA layer only). */
  drift?: DriftAssessment | null;
  className?: string;
  /** Official warnings relayed verbatim. Map mode draws the ones in force; ended ones stay in the workspace. */
  warnings?: OfficialWarning[] | null;
  /** Water-level gauges at or above the issuer's lowest threshold (the Flood gauges layer). */
  gauges?: GaugeReading[] | null;
  transport?: HazeTransportView | null;
  /** Snapshot FIRMS detections (interim Fires layer until the fires module lands). */
  hotspots?: MapHotspot[] | null;
  /** 925 hPa wind grid for the particles (modelled). */
  windGrid?: WindGrid | null;
  airQuality?: AirQualityData | null;
  /** The one forecast hour (App). Drives haze, particles, city circles and the ash scenario. */
  hazeHour?: HazeHour | null;
  /** Basemap and overlay theme; without it the map follows <html data-theme>. */
  theme?: 'dark' | 'light';
  /** Modelled pressure-level winds at the volcano summits (ash drift and the interim scenario). */
  ashWind?: AshWindData | null;
  /** Volcano watch id whose "If it erupted now" scenario plays; null when none. */
  scenarioId?: string | null;
  /** The eruption module's plume layers for a time (ms); replaces the interim plume when given. */
  scenarioLayers?: ((timeMs: number, ctx: MapLayerContext) => LayersList) | null;
  /** Extra deck.gl layers from teammates' modules (e.g. the fire heat grid), rebuilt when ctx changes. */
  extraLayers?: ((ctx: MapLayerContext) => LayersList) | null;
  quakes?: QuakesResult | null;
  riverFlow?: RiverDischargeSeries[] | null;
  /** Where to look when the selection is a fire (a cluster, cell or region centre). */
  focusPoint?: { lat: number; lon: number } | null;
  /** A one-off camera request (a workspace "Fly to"); a new seq flies again. */
  flyRequest?: { lat: number; lon: number; zoom?: number; seq: number } | null;
}

// ---------------------------------------------------------------------------------------------
// Constants

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
const MAP_LABEL = 'Regional map of haze, fires, volcanoes and official warnings. Drag or use the arrow keys to pan; scroll, pinch, or plus and minus to zoom.';

/** Reference distances from a volcano's summit (km). Distance only, not a hazard zone. */
const RING_KM = [5, 10, 15];
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
const ASH_WIDTH: Record<AshLevel, number> = { '700': 3.25, '500': 2.5, '300': 2 };
const MAX_TSUNAMI_MARKERS = 80;
const SINGAPORE: LonLat = [103.8198, 1.3521];
const DRIFT_LENGTH_KM = 111.2;
const DRIFT_HALF_ANGLE_DEG = 15;
const MAX_WARNING_MARKERS = 120;
const MAX_GAUGE_MARKERS = 40;
/** Container width at or below which the phone arrangement applies. */
const NARROW_MAX = 640;
const FIT_MARGIN = { top: 40, bottom: 40, left: 48, right: 48 };
const REGION_MARGIN = { top: 12, bottom: 12, left: 12, right: 12 };
const FALLBACK_APAC: Bounds = [
  [92.2, -11],
  [141, 28.6],
];
/** Zoom a city or warning is shown at when selected (kept when the map is already closer). */
const POINT_ZOOM = { min: 5.6, max: 8 };
/** Zoom a volcano is shown at when selected: its region, not its crater. */
const VOLCANO_ZOOM = { min: 6.8, max: 8.5 };
/** The interim scenario plume length (hours after the assumed start). */
const SCENARIO_HOURS = 24;

const ARROW_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M4 26.5h34V14l24 18-24 18V37.5H4z" fill="#fff"/></svg>',
)}`;
const ARROW_MAPPING = { arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } };

/** Additive colour blending for glows on the dark map (overlaps brighten). */
const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

const NO_HOTSPOTS: MapHotspot[] = [];
const NO_LAYERS: LayersList = [];

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
// Formatting

/** "2026-10-13T06:40:00Z" → "13 Oct 06:40 UTC" (deterministic). */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value);
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

const withAlpha = (c: Rgb | Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

// ---------------------------------------------------------------------------------------------
// Symbols

/** A volcano: a triangle ringed in the official level's colour (the issuer's scale; grey when unknown). */
function VolcanoSymbol({ selected }: { selected: boolean }) {
  return (
    <>
      {selected && <circle className="mv-select-ring" cx="18" cy="18" r="17" />}
      <circle className="mv-level-halo" cx="18" cy="18" r="13.5" />
      <circle className="mv-level-ring" cx="18" cy="18" r="13.5" />
      <path className="mv-volcano" d="M18 9.5 26 24.5H10Z" />
    </>
  );
}

/** A haze watch area (fire-prone peatland box): a flame in a ring. */
function FireAreaSymbol({ selected }: { selected: boolean }) {
  return (
    <>
      {selected && <circle className="mv-select-ring" cx="18" cy="18" r="17" />}
      <circle className="mv-area-ring" cx="18" cy="18" r="13" />
      <path
        className="mv-area-flame"
        d="M18.6 9.5c.5 2.6 3.6 4 3.6 8a4.2 4.2 0 0 1-8.4 0c0-2.2 1.2-3.5 2.1-4.6.2 1.6.9 2.6 1.7 2.9-.5-2.2-.2-4.4 1-6.3z"
      />
    </>
  );
}

type OfficialKind = 'official' | 'ended' | 'estimate' | 'gauge';

/** Reserved official-style symbols: pin = official warning (dashed when ended), hollow dashed circle = impact estimate, square = gauge. */
function OfficialSymbol({ kind, selected = false }: { kind: OfficialKind; selected?: boolean }) {
  return (
    <>
      {selected && <circle className="mv-select-ring" cx="12" cy="12" r="11" />}
      {kind === 'estimate' ? (
        <circle className="mv-wcircle" cx="12" cy="12" r="5.5" />
      ) : kind === 'gauge' ? (
        <rect className="mv-gsquare" x="7.5" y="7.5" width="9" height="9" />
      ) : (
        <>
          <path className={`mv-wpin${kind === 'ended' ? ' is-ended' : ''}`} d="M12 21.5s-6-6.1-6-11a6 6 0 0 1 12 0c0 4.9-6 11-6 11z" />
          <circle className="mv-wpin-dot" cx="12" cy="10.5" r="2.1" />
        </>
      )}
    </>
  );
}

const CHIP_ICONS: Partial<Record<LayerKey, (p: { size?: number }) => ReactNode>> = {
  haze: HazeIcon,
  fires: FireIcon,
  watch: VolcanoIcon,
  warnings: WarningIcon,
};

function WindChipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2.5 7.5h9a2.5 2.5 0 1 0-2.5-2.5M2.5 12.5h12a2.5 2.5 0 1 1-2.5 2.5M2.5 10h6" />
    </svg>
  );
}

function SatelliteChipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="7.5" y="7.5" width="5" height="5" transform="rotate(45 10 10)" />
      <path d="m4 4 3 3M13 13l3 3M2.5 9.5l2-2 3 3-2 2zM12.5 15.5l2-2 3 3-2 2z" />
    </svg>
  );
}

/** Non-chip layers that count as "extra" when on (rings and tsunami areas follow the selection and the feed). */
const EXTRA_KEYS = LAYER_CATALOG.filter((l) => !l.chip && l.key !== 'rings' && l.key !== 'tsunami').map((l) => l.key);

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
  return r.w * r.h - overlap(r, f);
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

/** The theme from the prop, else the document's data-theme (dark unless "light"). */
function resolveTheme(theme: 'dark' | 'light' | undefined): 'dark' | 'light' {
  if (theme) return theme;
  try {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Part of a drift track up to `ms`, with the interpolated head; null before the start. */
function trackUpTo(track: DriftTrack, ms: number): { path: LonLat[]; head: LonLat } | null {
  const pts = track.points;
  if (pts.length < 2) return null;
  const t0 = Date.parse(pts[0].time);
  if (!(ms > t0)) return null;
  const path: LonLat[] = [];
  for (let k = 0; k < pts.length; k += 1) {
    const t = Date.parse(pts[k].time);
    if (t <= ms) {
      path.push([pts[k].lon, pts[k].lat]);
      continue;
    }
    const prev = pts[k - 1];
    const tp = Date.parse(prev.time);
    const f = (ms - tp) / Math.max(1, t - tp);
    path.push([prev.lon + (pts[k].lon - prev.lon) * f, prev.lat + (pts[k].lat - prev.lat) * f]);
    break;
  }
  return path.length >= 2 ? { path, head: path[path.length - 1] } : null;
}

// ---------------------------------------------------------------------------------------------

export default function MapView({
  incidents,
  placeNames,
  selection,
  onSelect,
  layers,
  onLayersChange,
  onOpenLayers,
  card = null,
  levels = {},
  nea = null,
  drift = null,
  className,
  warnings = null,
  gauges = null,
  transport = null,
  hotspots = null,
  windGrid = null,
  airQuality = null,
  hazeHour = null,
  theme,
  ashWind = null,
  scenarioId = null,
  scenarioLayers = null,
  extraLayers = null,
  quakes = null,
  riverFlow = null,
  focusPoint = null,
  flyRequest = null,
}: MapViewProps) {
  /** Open chart popover (analyst layers): a tide gauge (code) or a river point (id), at a point in the map container. */
  const [chart, setChart] = useState<{ kind: 'tide' | 'river'; id: string; at: { x: number; y: number } } | null>(null);
  /** Wall clock once per mount: ash drift starts at the forecast hour at or before it. */
  // The shared page clock (ticks with the warnings refresh): expiry, "last 24 h" quakes, image times.
  const nowMs = useNowMs();
  const [dark, setDark] = useState(() => resolveTheme(theme) === 'dark');
  const [narrow, setNarrow] = useState(false);
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [stride, setStride] = useState(4);
  const [zoomBucket, setZoomBucket] = useState(4);
  /** Roving tabindex for the official/gauge markers: index of the one tab stop. */
  const [officialActive, setOfficialActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const probeLRef = useRef<HTMLSpanElement>(null);
  const probeRRef = useRef<HTMLSpanElement>(null);
  const probeTRef = useRef<HTMLSpanElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const deckRef = useRef<MapboxOverlay | null>(null);
  const hazeRef = useRef<HazeLayerController | null>(null);
  const padRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const darkRef = useRef(dark);
  const narrowRef = useRef(false);
  const buildingsRef = useRef(layers.buildings);
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
  const scenarioDeckRef = useRef<LayersList>([]);
  const hazeInputRef = useRef<HazeLayerInput | null>(null);
  const officialTabRef = useRef(-1);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const pal = getMapPalette(dark ? 'dark' : 'light');
  const themeName: 'dark' | 'light' = dark ? 'dark' : 'light';
  const timeISO = hazeHour?.timeISO ?? '';

  // --- Derived data (memoised; none of it depends on the camera) ------------------------------

  const selectedAreaId = selection?.kind === 'area' ? selection.id : null;
  const selectedWarningId = selection?.kind === 'warning' ? selection.id : null;
  const selectedCityId = selection?.kind === 'city' ? selection.id : null;
  // A new selection flies the camera, so a tide or river chart pinned to a pixel would point at nothing.
  const selectionKey = selection ? `${selection.kind}:${selection.id}` : '';
  useEffect(() => {
    setChart(null);
  }, [selectionKey]);

  const placed = useMemo(
    () =>
      incidents
        .filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon))
        .map((incident) => ({ incident, name: placeNames?.[incident.id]?.trim() || incident.title })),
    [incidents, placeNames],
  );
  const selectedIncident = placed.find((p) => p.incident.id === selectedAreaId)?.incident ?? null;
  const neaShown = Boolean(layers.nea && selectedIncident && nea && drift && drift.incidentId === selectedIncident.id);
  const downwindDeg = neaShown && drift && drift.downwindDeg !== null && Number.isFinite(drift.downwindDeg) ? drift.downwindDeg : null;

  /** Warnings that are a volcano's official level: drawn as the triangle's ring, not as a second pin. */
  const levelWarningIds = useMemo(() => new Set(Object.values(levels).flatMap((l) => (l ? [l.warningId] : []))), [levels]);

  const warningMarkers = useMemo(
    () =>
      (warnings ?? [])
        .filter((w) => w.location && Number.isFinite(w.location.lat) && Number.isFinite(w.location.lon))
        .filter((w) => !isExpired(w, nowMs) || w.id === selectedWarningId)
        .filter((w) => !levelWarningIds.has(w.id) || w.id === selectedWarningId)
        .sort(compareWarningMarkers)
        .slice(0, MAX_WARNING_MARKERS),
    [warnings, selectedWarningId, levelWarningIds, nowMs],
  );

  const gaugeMarkers = useMemo(() => {
    if (!layers.gauges) return [];
    return (gauges ?? [])
      .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon) && Number.isFinite(g.value))
      .map((gauge) => ({ gauge, excess: gaugeExcess(gauge) }))
      .filter((m) => (m.excess !== null ? m.excess >= 0 : m.gauge.situation !== null))
      .sort((a, b) => (b.excess ?? Number.NEGATIVE_INFINITY) - (a.excess ?? Number.NEGATIVE_INFINITY) || 0)
      .slice(0, MAX_GAUGE_MARKERS)
      .map((m) => m.gauge);
  }, [gauges, layers.gauges]);

  const ringsShown = Boolean(selectedIncident && selectedIncident.hazard === 'volcano' && layers.rings && layers.watch);
  const rings = useMemo(
    () =>
      ringsShown && selectedIncident
        ? RING_KM.map((km) => ({
            km,
            polygon: ringPolygon(selectedIncident.lon, selectedIncident.lat, km),
            label: destination(selectedIncident.lon, selectedIncident.lat, 45, km),
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
    return out.length ? { regions: out, mode: haze.dataMode === 'historical' ? 'saved' : 'live', time: haze.observedAt.slice(11, 16) } : null;
  }, [nea, layers.nea]);

  /** NEA wind at Singapore (toward), drawn whenever the NEA layer is on and a direction is known. */
  const seaWindToward = nea && layers.nea && nea.wind.fromDeg !== null && Number.isFinite(nea.wind.fromDeg) ? (nea.wind.fromDeg + 180) % 360 : null;
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
  const hotspotsShown = layers.fires && hotspots ? hotspots : NO_HOTSPOTS;

  // Ash drift for the selected volcano (modelled): the analyst layer draws all three 24 h tracks; the
  // scenario draws them growing with the scrubber from the scrubber's anchor hour.
  const ashSeries = useMemo(() => {
    if (!ashWind || !selectedIncident || selectedIncident.hazard !== 'volcano' || !selectedIncident.volcanoId) return null;
    return ashWind.volcanoes.find((v) => v.volcanoId === selectedIncident.volcanoId) ?? null;
  }, [ashWind, selectedIncident]);
  const ashDrift = useMemo(() => (ashSeries ? ashDriftTracks(ashSeries, nowMs) : null), [ashSeries, nowMs]);
  const ashShown = Boolean(ashDrift && layers.ash);
  const anchorISO = hazeHour ? (hazeHour.steps.times[hazeHour.steps.nowIndex] ?? '') : '';
  const scenarioActive = Boolean(scenarioId && selectedIncident && scenarioId === selectedIncident.id);
  const scenarioDrift = useMemo(() => {
    if (!scenarioActive || !ashSeries) return null;
    const anchor = Date.parse(anchorISO);
    return ashDriftTracks(ashSeries, Number.isFinite(anchor) ? anchor : nowMs);
  }, [scenarioActive, ashSeries, anchorISO, nowMs]);

  // Official BMKG InaTEWS tsunami warning areas (verbatim levels) at district centres (approximate).
  const tsunamiPick = useMemo(() => selectTsunamiAreaWarnings(warnings, nowMs), [warnings, nowMs]);
  const tsunamiInForce = tsunamiPick.inForce !== null;
  const tsunamiWarning = tsunamiPick.inForce ?? (layers.tsunamiHistory ? tsunamiPick.latest : null);
  const tsunamiPlacement = useMemo(() => (tsunamiWarning ? placeTsunamiAreas(tsunamiWarning.areas, idnDistrictIndex()) : null), [tsunamiWarning]);
  const tsunamiShown = Boolean(tsunamiWarning && tsunamiPlacement && layers.tsunami);
  const tsunamiAreaMarkers = tsunamiShown && tsunamiPlacement ? tsunamiPlacement.placed.slice(0, MAX_TSUNAMI_MARKERS) : [];
  const tsunamiObsMarkers = tsunamiShown && tsunamiWarning ? (tsunamiWarning.observations ?? []).slice(0, MAX_TSUNAMI_MARKERS) : [];

  // Analyst layers: earthquakes (USGS, BMKG), IOC tide gauges, modelled river flow, GIBS imagery.
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
  const gibsRef = useRef({ ir: false, tc: false, opacity: 0.75 });
  gibsRef.current = { ir: layers.satIr, tc: layers.satTrue, opacity: layers.satOpacity };

  const layerCtx = useMemo<MapLayerContext>(() => ({ theme: themeName, timeISO, zoom: zoomBucket, selection }), [themeName, timeISO, zoomBucket, selection]);

  // --- deck.gl layers (rebuilt only when inputs change, never per frame) -----------------------

  const extra = useMemo<LayersList>(() => {
    if (!extraLayers) return NO_LAYERS;
    try {
      return extraLayers(layerCtx);
    } catch (err) {
      console.error('Extra map layers could not be built:', err);
      return NO_LAYERS;
    }
  }, [extraLayers, layerCtx]);

  const deckLayers = useMemo<LayersList>(() => {
    const out: LayersList = [];
    const p = getMapPalette(dark ? 'dark' : 'light');
    const halo = p.halo;

    if (hazeRegions) {
      out.push(
        new ScatterplotLayer<(typeof hazeRegions.regions)[number]>({
          id: 'mv-psi-haze',
          data: hazeRegions.regions,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'meters',
          getRadius: PSI_RADIUS_M,
          getFillColor: (d) => [...p.nea.psiSmoke, Math.round(Math.min(1, psiHazeAlpha(d.band) * p.nea.psiAlphaScale) * 255)],
          stroked: false,
          updateTriggers: { getFillColor: [dark] },
        }),
      );
    }
    if (hotspotsShown.length > 0) {
      // Interim fire layer (snapshot FIRMS): a soft heat glow sized by fire power, and a small core.
      const glowRgb = p.fire.stops[2]?.c ?? p.fire.hotspot;
      out.push(
        new ScatterplotLayer<MapHotspot>({
          id: 'mv-firms-glow',
          data: hotspotsShown,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => 7 + Math.min(14, Math.sqrt(Math.max(0, d.frp)) * 2.2),
          filled: true,
          getFillColor: [...glowRgb, dark ? 70 : 60],
          stroked: false,
          parameters: p.fire.blend === 'additive' ? ADDITIVE : undefined,
          updateTriggers: { getFillColor: [dark] },
        }),
        new ScatterplotLayer<MapHotspot>({
          id: 'mv-firms',
          data: hotspotsShown,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => (d.current ? 3.6 : 2.8),
          filled: true,
          getFillColor: (d) => [...p.fire.hotspot, d.current ? 245 : 170],
          stroked: true,
          getLineColor: withAlpha(p.fire.halo, 220),
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          pickable: true,
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
      );
    }
    out.push(...extra);
    if (rings) {
      out.push(
        new PolygonLayer<(typeof rings)[number]>({
          id: 'mv-rings',
          data: [...rings].reverse(),
          getPolygon: (d) => d.polygon,
          filled: true,
          getFillColor: p.rings.fill,
          stroked: false,
          updateTriggers: { getFillColor: [dark] },
        }),
        new PathLayer<LonLat[]>({
          id: 'mv-rings-halo',
          data: rings.flatMap((r) => dashedPaths(r.polygon, 2, 1)),
          getPath: (d) => d,
          getColor: p.rings.halo,
          getWidth: 3.5,
          widthUnits: 'pixels',
          updateTriggers: { getColor: [dark] },
        }),
        new PathLayer<LonLat[]>({
          id: 'mv-rings-dash',
          data: rings.flatMap((r) => dashedPaths(r.polygon, 2, 1)),
          getPath: (d) => d,
          getColor: p.rings.line,
          getWidth: 1.4,
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
          getFillColor: p.nea.driftFill,
          stroked: true,
          getLineColor: p.nea.driftLine,
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
      );
    }
    if (seaWindToward !== null) {
      // NEA station wind at Singapore: a fixed-size arrow (pixels), so it reads the same at every zoom.
      const angle = 90 - seaWindToward;
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
          getColor: [...p.nea.windInk, windVariable ? 150 : 255],
          updateTriggers: { getAngle: [angle], getColor: [dark, windVariable] },
        }),
      );
    }
    if (transport && transportShown) {
      // The 925 hPa particles replace the 10 m arrows when that wind grid is loaded; the paths stay.
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
          getColor: p.modelled.arrow,
          updateTriggers: { getColor: [dark] },
        }),
      );
      const paths = transport.paths.filter((t) => t.points.length > 1);
      out.push(
        new PathLayer<(typeof paths)[number]>({
          id: 'mv-haze-paths',
          data: paths,
          getPath: (d) => d.points.map((pt) => [pt.lon, pt.lat] as LonLat),
          getColor: (d) => [...p.modelled.path, d.reaches ? 235 : 170],
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
          getLineColor: [...p.modelled.path, 220],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.4,
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
      );
    }
    if (ashShown && ashDrift && !scenarioActive) {
      const tracks = ashDrift.tracks.filter((t) => t.points.length > 1);
      const ticks = tracks.flatMap((t) => t.ticks.map((k) => ({ ...k, level: t.level })));
      const tickLabels = ticks.filter((k) => k.hour < 24);
      const labelDy: Record<AshLevel, number> = { '700': -10, '500': 0, '300': 10 };
      const ends = tracks.map((t) => ({ track: t, at: t.points[t.points.length - 1] }));
      out.push(
        new PathLayer<DriftTrack>({
          id: 'mv-ash-halo',
          data: tracks,
          getPath: (d) => d.points.map((pt) => [pt.lon, pt.lat] as LonLat),
          getColor: p.ash.halo,
          getWidth: (d) => ASH_WIDTH[d.level] + 3,
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          updateTriggers: { getColor: [dark] },
        }),
        new PathLayer<DriftTrack>({
          id: 'mv-ash-paths',
          data: tracks,
          getPath: (d) => d.points.map((pt) => [pt.lon, pt.lat] as LonLat),
          getColor: (d) => [...p.ash.lines[d.level], 245],
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
          getLineColor: (d) => [...p.ash.lines[d.level], 255],
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
          getColor: (d) => [...p.ash.lines[d.level], 255],
          getPixelOffset: [7, -9],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 600,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: p.label.halo,
          updateTriggers: { getColor: [dark] },
        }),
        new TextLayer<(typeof ends)[number]>({
          id: 'mv-ash-level-labels',
          data: ends,
          getPosition: (d) => [d.at.lon, d.at.lat],
          getText: (d) => `ash at ${d.track.label.replace(/^~/, '')} up${d.track.ticks.some((k) => k.hour === 24) ? ' · 24 h' : ''}`,
          getSize: 12.5,
          sizeUnits: 'pixels',
          getColor: (d) => [...p.ash.lines[d.track.level], 255],
          getPixelOffset: (d) => [9, labelDy[d.track.level]],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 700,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: p.label.halo,
          updateTriggers: { getColor: [dark] },
        }),
      );
    }
    if (tideShown.length > 0) {
      out.push(
        new ScatterplotLayer<SeaLevelStation>({
          id: 'mv-tide',
          data: tideShown,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: 4,
          filled: true,
          getFillColor: p.tide.fill,
          stroked: true,
          getLineColor: p.tide.stroke,
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
      const colour = (q: QuakeEvent): Rgba => [...p.quake[quakeDepthBand(q.depthKm)], alpha(q)];
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
          updateTriggers: { getLineColor: [dark, nowMs], getFillColor: [dark, nowMs], getLineWidth: [nowMs] },
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
          updateTriggers: { getLineColor: [dark, nowMs], getLineWidth: [nowMs] },
        }),
      );
    }
    return out;
  }, [hazeRegions, rings, driftCone, seaWindToward, windVariable, transport, transportShown, stride, hotspotsShown, dark, windGrid, ashShown, ashDrift, scenarioActive, quakesShown, tideShown, nowMs, extra]);

  const pushDeck = useCallback(() => {
    deckRef.current?.setProps({ layers: [...deckLayersRef.current, ...scenarioDeckRef.current] });
  }, []);

  useEffect(() => {
    deckLayersRef.current = deckLayers;
    pushDeck();
  }, [deckLayers, pushDeck]);

  // --- The ash scenario: drawn for a time that glides between scrubber steps (no React per frame) -----

  const buildScenario = useCallback(
    (ms: number): LayersList => {
      if (!scenarioActive) return NO_LAYERS;
      if (scenarioLayers) {
        try {
          return scenarioLayers(ms, layerCtx);
        } catch (err) {
          console.error('Scenario layers could not be built:', err);
          return NO_LAYERS;
        }
      }
      if (!scenarioDrift || !selectedIncident) return NO_LAYERS;
      const p = getMapPalette(dark ? 'dark' : 'light');
      const start = Date.parse(scenarioDrift.startISO);
      const end = start + SCENARIO_HOURS * 3_600_000;
      const t = Math.min(ms, end);
      const parts = scenarioDrift.tracks.flatMap((track) => {
        const part = trackUpTo(track, t);
        return part ? [{ level: track.level, ...part }] : [];
      });
      const hours = Math.max(0, (t - start) / 3_600_000);
      const label = [
        {
          at: [selectedIncident.lon, selectedIncident.lat] as LonLat,
          text: ms < start ? 'MODELLED SCENARIO · before the assumed start' : `MODELLED SCENARIO · +${Math.round(hours)} h after an assumed eruption`,
        },
      ];
      const glow = p.ash.plumeEdge;
      const core = p.ash.plumeCore;
      return [
        new PathLayer<(typeof parts)[number]>({
          id: 'mv-scenario-body',
          data: parts,
          getPath: (d) => d.path,
          getColor: glow,
          getWidth: (d) => (d.level === '300' ? 26 : d.level === '500' ? 20 : 14),
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          parameters: dark ? ADDITIVE : undefined,
        }),
        new PathLayer<(typeof parts)[number]>({
          id: 'mv-scenario-core',
          data: parts,
          getPath: (d) => d.path,
          getColor: (d) => [...p.ash.lines[d.level], 235],
          getWidth: (d) => ASH_WIDTH[d.level],
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
        }),
        new ScatterplotLayer<(typeof parts)[number]>({
          id: 'mv-scenario-heads',
          data: parts,
          getPosition: (d) => d.head,
          radiusUnits: 'pixels',
          getRadius: (d) => (d.level === '300' ? 13 : d.level === '500' ? 11 : 9),
          filled: true,
          getFillColor: core,
          stroked: true,
          getLineColor: (d) => [...p.ash.lines[d.level], 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.5,
        }),
        new TextLayer<(typeof label)[number]>({
          id: 'mv-scenario-label',
          data: label,
          getPosition: (d) => d.at,
          getText: (d) => d.text,
          getSize: 12,
          sizeUnits: 'pixels',
          getColor: p.label.text,
          getPixelOffset: [0, 26],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 700,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: p.label.halo,
        }),
      ];
    },
    [scenarioActive, scenarioLayers, scenarioDrift, selectedIncident, dark, layerCtx],
  );

  const scenarioMsRef = useRef<number>(Number.NaN);
  useEffect(() => {
    if (!scenarioActive) {
      scenarioDeckRef.current = NO_LAYERS;
      scenarioMsRef.current = Number.NaN;
      pushDeck();
      return;
    }
    const target = Date.parse(timeISO);
    if (!Number.isFinite(target)) return;
    const from = Number.isFinite(scenarioMsRef.current) ? scenarioMsRef.current : target;
    const duration = prefersReducedMotion() ? 0 : Math.min(900, hazeHour?.stepMs ?? 900);
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const f = duration <= 0 ? 1 : Math.min(1, (now - t0) / duration);
      const ms = from + (target - from) * f;
      scenarioMsRef.current = ms;
      scenarioDeckRef.current = buildScenario(ms);
      pushDeck();
      if (f < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [scenarioActive, timeISO, buildScenario, pushDeck, hazeHour?.stepMs]);

  // --- Haze layer controller ------------------------------------------------------------------

  const handleCityClick = useCallback((c: HazeCity) => {
    onSelectRef.current({ kind: 'city', id: c.id });
  }, []);
  const hazeTimeShown = timeISO || transport?.time || windGrid?.times[0] || '';
  const hazeInput = useMemo<HazeLayerInput>(
    () => ({
      windGrid,
      airQuality,
      timeISO: hazeTimeShown,
      dark,
      visible: { particles: layers.particles, haze: layers.haze, cities: layers.haze },
      onCityClick: handleCityClick,
      neaHaze: layers.nea ? (nea?.haze ?? null) : null,
      selectedCityId,
    }),
    [windGrid, airQuality, hazeTimeShown, dark, layers.particles, layers.haze, layers.nea, handleCityClick, nea, selectedCityId],
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
      const pt = map.project([num(el.dataset.lon), num(el.dataset.lat)]);
      const off = !(pt.x > -80 && pt.y > -80 && pt.x < w + 80 && pt.y < h + 80);
      if (off) {
        if (el.dataset.off !== '1') el.dataset.off = '1';
        continue;
      }
      if (el.dataset.off === '1') el.dataset.off = '0';
      el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
    }
    const near = map.getZoom() >= NEAR_ZOOM ? 'true' : 'false';
    if (root.dataset.near !== near) root.dataset.near = near;
  }, []);

  /** Tag sides (greedy, avoiding markers, other tags and the chrome) and warning hover sides; on moveend only. */
  const layoutTags = useCallback(() => {
    const map = mapRef.current;
    const root = overlayRef.current;
    if (!map || !root) return;
    const { w, h } = sizeRef.current;
    const pad = padRef.current;
    const frame: Rect = { x: pad.left, y: pad.top, w: Math.max(0, w - pad.left - pad.right), h: Math.max(0, h - pad.top - pad.bottom) };
    const markers = Array.from(root.querySelectorAll<HTMLElement>('.mv-marker')).filter((el) => el.dataset.off !== '1');
    markers.sort((a, b) => Number(b.classList.contains('is-selected')) - Number(a.classList.contains('is-selected')));
    const pts = markers.map((el) => map.project([num(el.dataset.lon), num(el.dataset.lat)]));
    const occupied: (Rect & { weight?: number })[] = pts.map((pt) => ({ x: pt.x - 18, y: pt.y - 18, w: 36, h: 36 }));
    const wmarkers = Array.from(root.querySelectorAll<HTMLElement>('.mv-wmarker')).filter((el) => el.dataset.off !== '1');
    for (const el of wmarkers) {
      const pt = map.project([num(el.dataset.lon), num(el.dataset.lat)]);
      occupied.push({ x: pt.x - 10, y: pt.y - 10, w: 20, h: 20 });
      el.dataset.side = `${pt.x - frame.x > frame.w * 0.62 ? 'l' : 'r'}${pt.y > h * 0.62 ? 'u' : 'd'}`;
    }
    markers.forEach((el, i) => {
      const tag = el.querySelector<HTMLElement>('.mv-tag');
      if (!tag) return;
      const tw = tag.offsetWidth;
      const th = tag.offsetHeight;
      const gap = 20;
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

  /** Shell chrome (drawer, card, top bar) and the dock → camera padding. The map content stays still. */
  const syncPadding = useCallback(() => {
    const map = mapRef.current;
    const root = rootRef.current;
    if (!map || !root) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const horiz = overlayPadding(probeLRef.current?.offsetWidth ?? 0, probeRRef.current?.offsetWidth ?? 0, width);
    const dockH = dockRef.current?.offsetHeight ?? 0;
    const cardH = narrowRef.current ? (cardRef.current?.offsetHeight ?? 0) : 0;
    root.style.setProperty('--mv-dock-h', `${dockH}px`);
    let top = probeTRef.current?.offsetWidth ?? 0;
    let bottom = Math.max(dockH, cardH) + 8;
    const room = height - 140;
    if (top + bottom > room) {
      const f = Math.max(0, room) / (top + bottom);
      top = Math.round(top * f);
      bottom = Math.round(bottom * f);
    }
    const next = { ...horiz, top, bottom };
    padRef.current = next;
    const prev = map.getPadding();
    if (prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom) return;
    if (map.isMoving()) {
      map.setPadding(next);
      return;
    }
    // Keep what was centred in the old visible area centred in the new one.
    const pl = prev.left ?? 0;
    const pr = prev.right ?? 0;
    const pt = prev.top ?? 0;
    const pb = prev.bottom ?? 0;
    const prevCx = pl + (width - pl - pr) / 2;
    const prevCy = pt + (height - pt - pb) / 2;
    map.jumpTo({ center: map.unproject([prevCx, prevCy]), padding: next });
  }, []);

  /** Fly to a watch area (±0.3° around a summit, or the box with a margin), or fit the region. */
  const fitTo = useCallback(
    (incident: Incident | null, animate: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      syncPadding();
      const { w, h } = sizeRef.current;
      const pad = padRef.current;
      const visW = Math.max(0, w - pad.left - pad.right);
      const visH = Math.max(0, h - pad.top - pad.bottom);
      const want = incident ? FIT_MARGIN : REGION_MARGIN;
      // MapLibre adds the map's own padding (the chrome, set by syncPadding) to these margins.
      const m = {
        top: Math.min(want.top, visH / 6),
        bottom: Math.min(want.bottom, visH / 6),
        left: Math.min(want.left, visW / 6),
        right: Math.min(want.right, visW / 6),
      };
      const duration = animate && !prefersReducedMotion() ? (incident ? 1600 : 1200) : 0;
      if (incident?.hazard === 'volcano') {
        // A world-eye view of a volcano: the summit in its region (towns, coast, where ash would go), not
        // the crater. Closer zooms are the reader's choice, kept when already closer.
        const zoom = Math.max(VOLCANO_ZOOM.min, Math.min(VOLCANO_ZOOM.max, map.getZoom()));
        map.flyTo({ center: [incident.lon, incident.lat], zoom, padding: padRef.current, duration, essential: false, curve: 1.3, bearing: 0, pitch: 0 });
        return;
      }
      const bounds: LngLatBoundsLike = incident ? selectionBounds(incident) : apacBounds();
      map.fitBounds(bounds, { padding: m, duration, maxZoom: 7.5, essential: false, bearing: 0, pitch: 0 });
    },
    [syncPadding],
  );

  /** Fly to a point (a city, a warning) at a regional zoom, keeping a closer zoom if the map already has one. */
  const flyToPoint = useCallback(
    (lon: number, lat: number) => {
      const map = mapRef.current;
      if (!map || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
      syncPadding();
      const zoom = Math.max(POINT_ZOOM.min, Math.min(POINT_ZOOM.max, map.getZoom()));
      const reduce = prefersReducedMotion();
      map.flyTo({ center: [lon, lat], zoom, padding: padRef.current, duration: reduce ? 0 : 1300, essential: false, curve: 1.3 });
    },
    [syncPadding],
  );

  /** Fit a set of points (the scenario's drift) in the visible map. */
  const fitPoints = useCallback(
    (points: readonly LonLat[]) => {
      const map = mapRef.current;
      if (!map || points.length === 0) return;
      syncPadding();
      const lons = points.map((pt) => pt[0]);
      const lats = points.map((pt) => pt[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 48, duration: prefersReducedMotion() ? 0 : 1200, maxZoom: 7.5, essential: false, bearing: 0, pitch: 0 },
      );
    },
    [syncPadding],
  );

  // Starting a scenario frames the whole 24 h drift, so the plume grows in view.
  useEffect(() => {
    if (!ready || !scenarioActive || !scenarioDrift || !selectedIncident) return;
    const pts: LonLat[] = [[selectedIncident.lon, selectedIncident.lat], ...scenarioDrift.tracks.flatMap((t) => t.points.map((pt) => [pt.lon, pt.lat] as LonLat))];
    fitPoints(pts);
    // Only when a scenario starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, scenarioActive, scenarioDrift !== null]);

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
    if (want.ir && want.tc && map.getLayer(`${gibsIr.id}-layer`) && map.getLayer(`${gibsTrue.id}-layer`)) {
      map.moveLayer(`${gibsTrue.id}-layer`, `${gibsIr.id}-layer`);
    }
  };
  // Re-sync on a toggle, the opacity, or a newer image time from the clock.
  const gibsIrTiles = gibsIr.tiles[0];
  const gibsTrueTiles = gibsTrue.tiles[0];
  useEffect(() => {
    if (ready) syncGibsRef.current();
  }, [ready, layers.satIr, layers.satTrue, layers.satOpacity, gibsIrTiles, gibsTrueTiles]);

  // 3D buildings follow their layer toggle.
  useEffect(() => {
    buildingsRef.current = layers.buildings;
    const map = mapRef.current;
    if (!ready || !map?.getLayer(BUILDINGS_LAYER)) return;
    map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', layers.buildings ? 'visible' : 'none');
    if (layers.buildings && map.getZoom() >= BUILDINGS_MIN_ZOOM && map.getPitch() < 10) {
      map.easeTo({ pitch: 50, duration: prefersReducedMotion() ? 0 : 600 });
    }
  }, [ready, layers.buildings]);

  // --- Map lifecycle ---------------------------------------------------------------------------

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
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
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: CREDITS }), 'bottom-right');

    let timer: number | undefined;
    styleReadyRef.current = false;
    let offlineMode = false;
    let tilesOk = false;
    let tileErrors = 0;
    const themeOf = (isDark: boolean) => (isDark ? 'dark' : 'light') as 'dark' | 'light';
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
    const loadLive = (isDark: boolean) => {
      styleReadyRef.current = false;
      tilesOk = false;
      tileErrors = 0;
      map.setStyle(basemapStyleFor(themeOf(isDark)), basemapStyleOptions(themeOf(isDark)));
      arm();
    };
    retryStyleRef.current = () => {
      if (!offlineMode) return;
      offlineMode = false;
      setOffline(false);
      loadLive(darkRef.current);
    };
    const onOnline = () => retryStyleRef.current?.();
    window.addEventListener('online', onOnline);
    applyStyleRef.current = (isDark: boolean) => {
      if (offlineMode) {
        styleReadyRef.current = false;
        map.setStyle(buildOfflineStyle(getRegion(), isDark), { diff: false });
        return;
      }
      loadLive(isDark);
    };
    loadLive(darkRef.current);

    map.on('style.load', () => {
      styleReadyRef.current = true;
      clearTimer();
      syncGibsRef.current();
      // The compact attribution starts collapsed at every width (the "i" button opens it).
      el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      const buildingSource = BASEMAP_BUILDING_SOURCES.find((id) => map.getSource(id));
      if (offlineMode || !buildingSource || map.getLayer(BUILDINGS_LAYER)) return;
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      const paint = buildingPaint(themeOf(darkRef.current));
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
            'fill-extrusion-color': paint.color,
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MIN_ZOOM, 0, BUILDINGS_MIN_ZOOM + 0.6, ['coalesce', ['get', 'render_height'], 6]],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': paint.opacity,
          },
        },
        firstSymbol,
      );
    });
    map.on('sourcedata', (e: MapSourceDataEvent) => {
      if (BASEMAP_BUILDING_SOURCES.includes(e.sourceId) && e.tile) tilesOk = true;
    });
    map.on('error', (e) => {
      // Handled here, so MapLibre does not log it: a failed style goes offline at once; tiles after 3 failures with none loaded.
      if (offlineMode) return;
      if (!styleReadyRef.current) {
        goOffline();
        return;
      }
      const sourceId = (e as unknown as { sourceId?: string }).sourceId;
      if (!tilesOk && sourceId !== undefined && BASEMAP_BUILDING_SOURCES.includes(sourceId)) {
        tileErrors += 1;
        if (tileErrors >= 3) goOffline();
      }
    });

    map.on('load', () => {
      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: [...deckLayersRef.current, ...scenarioDeckRef.current],
        getTooltip: (info: PickingInfo) => {
          const id = info.layer?.id ?? '';
          if (info.object && (id === 'mv-quakes-usgs' || id === 'mv-quakes-bmkg')) {
            return { text: quakeTooltip(info.object as QuakeEvent, USGS_TSUNAMI_FLAG_NOTE), className: 'mv-tooltip' };
          }
          if (info.object && id === 'mv-tide') {
            const st = info.object as SeaLevelStation;
            return { text: `Sea-level gauge ${st.name} (IOC ${st.code})\nRaw data, includes the tide; not a tsunami warning\nClick for the last 24 h`, className: 'mv-tooltip' };
          }
          const h = info.object as MapHotspot | undefined;
          if (!h || id !== 'mv-firms') return null;
          return {
            text: `Satellite heat spot (NASA FIRMS)\n${h.confidenceLabel} confidence · ${formatValue(h.frp)} MW\n${formatUtc(h.observedAt)}\nNot a confirmed fire`,
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
      // A user pan or zoom: the tide and river chart popovers are pinned to a pixel, so close them.
      if ((e as { originalEvent?: unknown }).originalEvent) setChart(null);
    });
    map.on('moveend', () => {
      positionOverlays();
      layoutTags();
      const z = map.getZoom();
      const s = windArrowStride(z);
      setStride((prev) => (prev === s ? prev : s));
      const b = Math.round(z * 2) / 2;
      setZoomBucket((prev) => (prev === b ? prev : b));
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

  // Container size: phone arrangement, padding, overlay bounds.
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
    selection,
    layers,
    narrow,
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
    levels,
    syncPadding,
    positionOverlays,
    layoutTags,
  ]);

  // The shell chrome (drawer, card, top bar) publishes its footprint through custom properties that size
  // the probes; the dock and the card slot are measured directly. Follow all of them.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const els = [probeLRef.current, probeRRef.current, probeTRef.current, dockRef.current, cardRef.current].filter((p): p is HTMLElement => p !== null);
    if (els.length === 0) return;
    const observer = new ResizeObserver(() => {
      syncPadding();
      positionOverlays();
      layoutTags();
    });
    els.forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, [syncPadding, positionOverlays, layoutTags, ready]);

  // Selecting something flies to it. Closing a card leaves the camera where it is. The first view fits the region.
  const target = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'area') return selectedIncident ? { kind: 'area' as const, incident: selectedIncident } : null;
    if (selection.kind === 'city') {
      const pl = airQuality?.places.find((c) => c.id === selection.id);
      return pl ? { kind: 'point' as const, lon: pl.lon, lat: pl.lat } : null;
    }
    if (selection.kind === 'warning') {
      const w = (warnings ?? []).find((x) => x.id === selection.id);
      return w?.location ? { kind: 'point' as const, lon: w.location.lon, lat: w.location.lat } : null;
    }
    if (selection.kind === 'fire' && focusPoint) return { kind: 'point' as const, lon: focusPoint.lon, lat: focusPoint.lat };
    return null;
  }, [selection, selectedIncident, airQuality, warnings, focusPoint]);
  const targetKey = selection && target ? `${selection.kind}:${selection.id}` : '';
  const firstFit = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (firstFit.current) {
      firstFit.current = false;
      if (!target) {
        fitTo(null, false);
        return;
      }
    }
    if (!target) return;
    if (target.kind === 'area') fitTo(target.incident, true);
    else flyToPoint(target.lon, target.lat);
    // Only a change of selection refits; free zoom and pan are left alone otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, ready]);

  // A workspace "Fly to" (fire cluster, province, city row).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !flyRequest) return;
    syncPadding();
    const zoom = flyRequest.zoom ?? Math.max(POINT_ZOOM.min, map.getZoom());
    map.flyTo({ center: [flyRequest.lon, flyRequest.lat], zoom, padding: padRef.current, duration: prefersReducedMotion() ? 0 : 1300, essential: false, curve: 1.3 });
    // Only a new request flies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, flyRequest?.seq]);

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
  const gaugesDrawn = gaugeMarkers;
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
          <strong>The map engine could not start</strong> (WebGL may be unavailable). The workspace sections still work.
        </p>
        <p className="mv-muted">{engineError}</p>
      </div>
    );
  }

  const tsunamiIssued = tsunamiWarning?.issuedAt ? formatUtc(tsunamiWarning.issuedAt) : 'issue time not given';
  const tsunamiStatus = !tsunamiWarning
    ? ''
    : tsunamiInForce
      ? `${tsunamiWarning.dataMode === 'live' ? 'Live' : 'Saved'} · issued ${tsunamiIssued}`
      : `Past message · ${tsunamiIssued} · ${isExpired(tsunamiWarning, nowMs) ? 'ended' : 'not ended'}`;
  const extrasOn = EXTRA_KEYS.filter((k) => layers[k]).length;
  const chipOn = (key: LayerKey) => (key === 'satIr' ? layers.satIr || layers.satTrue : layers[key]);
  const toggleChip = (key: LayerKey) => {
    if (key === 'satIr') {
      const on = layers.satIr || layers.satTrue;
      onLayersChange({ satIr: !on, satTrue: false });
      return;
    }
    onLayersChange({ [key]: !layers[key] } as Partial<MapLayerState>);
  };

  return (
    <div ref={rootRef} className={`map-view${dark ? ' is-dark' : ' is-light'}${narrow ? ' is-narrow' : ''}${card ? ' has-card' : ''}${className ? ` ${className}` : ''}`}>
      <div ref={mapElRef} className="mv-map" />
      <span ref={probeLRef} className="mv-probe is-left" aria-hidden="true" />
      <span ref={probeRRef} className="mv-probe is-right" aria-hidden="true" />
      <span ref={probeTRef} className="mv-probe is-top" aria-hidden="true" />

      <div ref={overlayRef} className="mv-overlay" data-ready={ready ? 'true' : 'false'} data-near="false">
        {rings?.map((r) => (
          <span key={r.km} className="mv-ring-label mv-near-only" data-lon={r.label[0]} data-lat={r.label[1]} aria-hidden="true">
            {r.km} km
          </span>
        ))}
        {hazeRegions?.regions.map((h) => (
          <span key={h.region} className="mv-haze-label mv-near-only" data-lon={h.lon} data-lat={h.lat}>
            {h.region === 'central' ? `PSI ${h.psi} · ${h.band} · NEA measured, ${hazeRegions.mode} ${hazeRegions.time} UTC` : `${h.region[0].toUpperCase()}${h.region.slice(1)} ${h.psi}`}
          </span>
        ))}
        {nea && seaWindToward !== null && (
          <span className="mv-wind-label mv-near-only" data-lon={SINGAPORE[0]} data-lat={SINGAPORE[1]}>
            Wind {windLine(nea)} · NEA stations
          </span>
        )}
        {driftCone && (
          <span className="mv-drift-label" data-lon={driftCone.label[0]} data-lat={driftCone.label[1]}>
            Rough drift with Singapore&apos;s wind
          </span>
        )}

        {officialCount > 0 && (
          <div className="mv-official-layer" role="group" aria-label="Official warnings on the map (arrow keys move between them)" onKeyDown={onOfficialKeyDown}>
            {warningsDrawn.map((w, i) => {
              const official = w.authority === 'official';
              const isSelected = w.id === selectedWarningId;
              const area = w.areaDescription.trim() || w.headline.trim();
              const label = official ? `Official warning: ${w.issuer} · ${w.level} · ${area}` : `Impact estimate (GDACS, not a warning): ${w.issuer} · ${w.level} · ${area}`;
              const kind: OfficialKind = !official ? 'estimate' : isExpired(w, nowMs) ? 'ended' : 'official';
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
                  onClick={() => onSelect(isSelected ? null : { kind: 'warning', id: w.id })}
                  {...officialProps(i)}
                >
                  <svg className="mv-wsymbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <OfficialSymbol kind={kind} selected={isSelected} />
                  </svg>
                  <span className="mv-wcallout" aria-hidden="true">
                    <strong>{w.issuer}</strong>
                    <span lang={w.language || undefined}>{w.level}</span>
                    {w.levelGloss && <span className="mv-wcallout-meta">Our gloss: {w.levelGloss}</span>}
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
              const label = `River gauge: ${g.name} · ${reading}${g.situation ? ` · ${g.situation}` : ''} · ${g.issuer}`;
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
                  onClick={cited ? () => onSelect({ kind: 'warning', id: cited.id }) : undefined}
                  {...officialProps(warningsDrawn.length + i)}
                >
                  <svg className="mv-wsymbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
                    onClick={() => onSelect({ kind: 'warning', id: tsunamiWarning.id })}
                    {...officialProps(tsunamiBase + i)}
                  >
                    <svg className="mv-wsymbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
                    onClick={() => onSelect({ kind: 'warning', id: tsunamiWarning.id })}
                    {...officialProps(tsunamiBase + tsunamiAreaMarkers.length + i)}
                  >
                    <svg className="mv-wsymbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
            aria-label={`${r.river} at ${r.place}: river flow forecast (GloFAS via Open-Meteo), not a flood warning`}
            onClick={(e) => {
              const box = rootRef.current?.getBoundingClientRect();
              const b = e.currentTarget.getBoundingClientRect();
              setChart({ kind: 'river', id: r.pointId, at: { x: b.left + b.width / 2 - (box?.left ?? 0), y: b.top + b.height / 2 - (box?.top ?? 0) } });
            }}
          >
            <span className="mv-river-dot" aria-hidden="true" />
            <span className="mv-river-tag" aria-hidden="true">
              {r.river} <span className="mv-river-sub">forecast</span>
            </span>
          </button>
        ))}

        {layers.watch &&
          placed.map(({ incident, name }) => {
            const isSelected = incident.id === selectedAreaId;
            const volcano = incident.hazard === 'volcano';
            const level = volcano ? (levels[incident.id] ?? null) : null;
            const ring = volcano ? pal.volcano.levelRing[volcanoLevelColour(level?.levelNumber ?? null)] : null;
            const style = volcano
              ? ({ '--lvl': rgbCss(ring as Rgba), '--vol-fill': rgbCss(pal.volcano.fill), '--vol-outline': rgbCss(pal.volcano.outline) } as CSSProperties)
              : undefined;
            const levelText = volcano ? (level ? `${level.level} (${level.issuer})` : 'No official level retrieved') : null;
            return (
              <button
                key={incident.id}
                type="button"
                className={`mv-marker${volcano ? ' is-volcano' : ' is-area'}${isSelected ? ' is-selected' : ''}`}
                data-lon={incident.lon}
                data-lat={incident.lat}
                style={style}
                aria-label={volcano ? `${name}, volcano. Official level: ${levelText}.` : `${name}, haze watch area`}
                aria-pressed={isSelected}
                onClick={() => onSelect(isSelected ? null : { kind: 'area', id: incident.id })}
              >
                <svg className="mv-symbol" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
                  {volcano ? <VolcanoSymbol selected={isSelected} /> : <FireAreaSymbol selected={isSelected} />}
                </svg>
                <span className="mv-tag" aria-hidden="true">
                  <span className="mv-tag-name">{name}</span>
                  {levelText && (
                    <span className="mv-tag-level" lang={level ? 'id' : undefined}>
                      {levelText}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>

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

      {card && (
        <div ref={cardRef} className="mv-card-slot" data-no-pan>
          <ErrorBoundary
            resetKey={selection ? `${selection.kind}:${selection.id}` : ''}
            fallback={(message) => (
              <p className="mv-card-error" role="alert">
                This card could not be shown ({message}). The workspace sections still have the data.
              </p>
            )}
          >
            {card}
          </ErrorBoundary>
        </div>
      )}

      <div ref={dockRef} className="mv-dock" data-no-pan>
        <div className="mv-chips" role="group" aria-label="Map layers">
          {MAP_CHIPS.map((c) => {
            const Icon = c.key === 'particles' ? WindChipIcon : c.key === 'satIr' ? SatelliteChipIcon : CHIP_ICONS[c.key];
            const on = chipOn(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className={`mv-chip mv-chip--${c.key}${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={c.explanation}
                onClick={() => toggleChip(c.key)}
              >
                {Icon && <Icon size={15} />}
                <span>{c.chipLabel}</span>
              </button>
            );
          })}
          {onOpenLayers && (
            <button type="button" className="mv-chip mv-chip--more" onClick={onOpenLayers} title="Every other layer, with an explanation (workspace)">
              <LayersIcon size={15} />
              <span>{extrasOn > 0 ? `+${extrasOn} more on` : 'More layers'}</span>
            </button>
          )}
          {offline && (
            <button type="button" className="mv-chip mv-chip--offline" onClick={() => retryStyleRef.current?.()} title="Street tiles are unavailable; showing bundled country outlines">
              Offline map · Retry
            </button>
          )}
        </div>
        {hazeHour && (
          <HazeScrubber
            className="mv-scrubber"
            steps={hazeHour.steps}
            index={hazeHour.index}
            onIndexChange={(i) => {
              hazeHour.setPlaying(false);
              hazeHour.setIndex(i);
            }}
            playing={hazeHour.playing}
            onPlayingChange={hazeHour.setPlaying}
            airQuality={airQuality}
            compact={narrow}
            scenario={scenarioActive}
          />
        )}
      </div>
    </div>
  );
}
