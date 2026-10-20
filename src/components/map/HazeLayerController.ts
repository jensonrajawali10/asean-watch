// Haze layer controller (haze agent). MapView only calls the public surface: constructor(map),
// update(input), destroy(). Draws on its OWN deck.gl overlay (overlaid mode, its own canvas), so it never
// fights MapView's overlay for layer ownership and survives basemap style switches (dark/light) untouched.
//   - Modelled PM2.5 haze (CAMS via Open-Meteo): a BitmapLayer from a bilinear raster with a smoke ramp.
//   - Modelled 925 hPa wind particles (Open-Meteo): its own requestAnimationFrame loop calling
//     overlay.setProps with a LineLayer of trail segments (binary attributes, no React per frame). Paused
//     when the tab is hidden or the map is off-screen; static streak arrows under prefers-reduced-motion.
//     Particle count scales with the visible grid area (CPU cap).
//   - City markers coloured by EPA-style PM2.5 band (MODELLED), with a band-tinted glow and halo labels
//     in both themes (colours from mapPalette.ts: cream on the dark map, ink outlines and white halos on
//     the light map); labels on hover or when zoomed in;
//     Singapore also shows NEA MEASURED 24-h PSI with its LIVE/SNAPSHOT tag in a visibly different chip.
// The overlay's container is placed directly above the map canvas (below MapLibre markers, popups and
// controls, and below any overlay MapView adds as a control), so haze never tints MapView's markers.
// Performance: the particle loop is capped at 30 fps, stops when the tab is hidden, the map is
// off-screen or no grid is in view, draws shorter trails at low zoom, and an adaptive budget sheds
// particles step-wise when frames run long (restoring slowly when there is headroom). During a pan or
// zoom the step and layer rebuilds pause (the trails stay drawn, following the camera).
// TODO(map-v2): merge into one shared deck.gl overlay with MapView (one canvas, one redraw per frame).
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, IconLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { HazeReading } from '../../types';
import { pm25Band, pm25Slice, placePm25At } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import { WIND_GRID_SPEC, windSlice } from '../../lib/windField';
import type { WindGrid, WindSlice } from '../../lib/windField';
import { AdaptiveBudget, FrameLimiter, intersectBox, ParticleSystem, rasterisePm25, streakArrows, trailForZoom } from './hazeRender';
import type { ParticleBox } from './hazeRender';
import { cityBandStyle, getMapPalette } from './mapPalette';
import { CITY_LABEL_ZOOM, cityDrawOrder, cityMarkerRadius, placeCityLabels, pulseRing, shortCityName, valueText, worstId } from './cityMarkers';

export type { AirQualityData };

/** Map attribution text for the haze layers (MapView adds it to its attribution control). */
export const HAZE_ATTRIBUTION = 'Wind and air quality: Open-Meteo (CC BY 4.0), CAMS · © OpenStreetMap contributors';

export interface HazeCity {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'city' | 'fire-area';
  /** MODELLED PM2.5 µg/m³ at the input time. */
  pm25: number;
}

export interface HazeLayerInput {
  /** 925 hPa wind for particles (modelled). */
  windGrid: WindGrid | null;
  airQuality: AirQualityData | null;
  /** ISO 8601 UTC hour shown by the forecast scrubber. */
  timeISO: string;
  dark: boolean;
  visible: { particles: boolean; haze: boolean; cities: boolean };
  /** Called when a city marker is clicked, with its pixel position in the map container. */
  onCityClick?: (city: HazeCity, at: { x: number; y: number }) => void;
  /** NEA measured haze (real readings) for Singapore's marker; optional. */
  neaHaze?: HazeReading | null;
  /** Highlight this city (e.g. while its popover is open). */
  selectedCityId?: string | null;
  /**
   * City labels decided by the map's shared collision plan (city id to text); cities not listed get none.
   * Without it the controller places its own labels.
   */
  labels?: ReadonlyMap<string, string> | null;
}

const GRID_BOX: ParticleBox = {
  west: WIND_GRID_SPEC.minLon,
  south: WIND_GRID_SPEC.minLat,
  east: WIND_GRID_SPEC.maxLon,
  north: WIND_GRID_SPEC.maxLat,
};
/** One particle per this many visible grid pixels, capped by MAX_PARTICLES and the adaptive budget. */
const PX_PER_PARTICLE = 170;
const MAX_PARTICLES = 6000;
const MIN_PARTICLES = 800;
/** Haze cross-fade between forecast hours (ms); instant under prefers-reduced-motion. */
const HAZE_FADE_MS = 650;
/** Wide faint pass under each particle trail (HazeView's "flow glow"): width multiple and opacity. */
const TRAIL_GLOW = { width: 3.2, opacity: 0.14 };
/** Particle frames per second (trails are tuned for this rate). */
const PARTICLE_FPS = 30;
const TRAIL = 6;
/** Screen pixels per second per m/s of wind. */
const PX_PER_S_PER_MS = 6;
/** MapLibre zoom from which every city label shows. */
const LABEL_ZOOM = CITY_LABEL_ZOOM;
const SINGAPORE_ID = 'singapore';
/**
 * Particle segments are uploaded as Float32 (lon, lat) offsets from this origin (LNGLAT_OFFSETS) in
 * fixed-size, double-buffered arrays. Measured on Intel UHD (headless Chrome, 1366×680, 3.1k particles):
 * 133 fps, against 7.6 fps for per-frame variable-length Float64 positions (deck.gl fp64 split + buffer
 * reallocation every frame).
 */
const SEG_ORIGIN: [number, number] = [107.5, 1];

type Rgb = [number, number, number];

/** Additive colour blending (overlapping trails and glows brighten), alpha composited normally. */
const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;
/** Overlay colours for the input's theme (mapPalette): cream trails on the dark map, slate ink on the light map. */
const paletteOf = (i: HazeLayerInput) => getMapPalette(i.dark);

const GLOW_PX = 64;
let glowUrl: string | null = null;
/** A white radial-gradient sprite (data URL) for the city glow; tinted per band with mask: true. */
function glowSprite(): string {
  if (glowUrl) return glowUrl;
  const c = document.createElement('canvas');
  c.width = GLOW_PX;
  c.height = GLOW_PX;
  const g = c.getContext('2d');
  if (g) {
    const r = GLOW_PX / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_PX, GLOW_PX);
  }
  glowUrl = c.toDataURL('image/png');
  return glowUrl;
}

function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function prefersReducedMotion(): MediaQueryList | null {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

const hhmm = (iso: string) => iso.slice(11, 16);

export class HazeLayerController {
  private readonly map: MapLibreMap;
  private readonly overlay: MapboxOverlay;
  private readonly container: HTMLElement | null;
  private input: HazeLayerInput | null = null;

  private slice: WindSlice | null = null;
  private sliceKey = '';
  private hazeLayer: Layer | null = null;
  private hazeKey = '';
  /** The previous hour's haze image while the new one fades in, and when the fade started. */
  private prevHaze: { image: HTMLCanvasElement; bounds: [number, number, number, number] } | null = null;
  private hazeImg: { image: HTMLCanvasElement; bounds: [number, number, number, number] } | null = null;
  private fadeStart = 0;
  /** Bumped on every map move end, so city labels are re-placed for the new view. */
  private viewSeq = 0;
  /** The worst city's id and radius at the current hour (for the pulse). */
  private worst: { id: string; lon: number; lat: number; r: number; rgb: Rgb } | null = null;
  private readonly hazeCache = new Map<string, { canvas: HTMLCanvasElement; bounds: [number, number, number, number] }>();
  private cityLayers: Layer[] = [];
  private cityKey = '';
  private streakLayer: Layer | null = null;
  private streakKey = '';
  private hoveredId: string | null = null;

  private readonly particles = new ParticleSystem(TRAIL);
  private readonly limiter = new FrameLimiter(PARTICLE_FPS);
  private readonly budget = new AdaptiveBudget(MAX_PARTICLES, { min: MIN_PARTICLES });
  /** Particles wanted for the visible grid area (before the budget). */
  private areaCount = 0;
  private lastRawT = 0;
  private box: ParticleBox | null = null;
  private segBufs: { from: Float32Array; to: Float32Array; color: Uint8Array }[] = [];
  private segFlip = 0;
  private raf = 0;
  private lastT = 0;
  /** True between the map's movestart and moveend: the particle step and layer rebuilds pause. */
  private cameraMoving = false;
  private hidden = typeof document !== 'undefined' ? document.hidden : false;
  private onScreen = true;
  private readonly motionQuery = prefersReducedMotion();
  private reduced = this.motionQuery?.matches ?? false;
  private observer: IntersectionObserver | null = null;
  private destroyed = false;
  /** Frames drawn in the last second (for diagnostics). */
  fps = 0;
  private fpsCount = 0;
  private fpsT = 0;

  constructor(map: MapLibreMap) {
    this.map = map;
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [], pickingRadius: 6 });
    // Overlaid mode returns its own container; put it right above the map canvas instead of in a control
    // corner, so MapLibre markers, popups, controls and MapView's own overlay all stay on top of the haze.
    const el = this.overlay.onAdd(map as never) as HTMLElement;
    const canvas = map.getCanvas();
    const parent = map.getCanvasContainer();
    if (canvas.parentElement === parent) parent.insertBefore(el, canvas.nextSibling);
    else parent.appendChild(el);
    this.container = el;

    map.on('movestart', this.onMoveStart);
    map.on('moveend', this.onMoveEnd);
    map.on('moveend', this.onViewChange);
    map.on('resize', this.onViewChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionQuery?.addEventListener('change', this.onMotionPref);
    if (typeof IntersectionObserver === 'function') {
      this.observer = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        this.syncLoop();
      });
      this.observer.observe(map.getContainer());
    }
  }

  /** Apply new input; cheap to call on every React render. */
  update(input: HazeLayerInput): void {
    if (this.destroyed) return;
    this.input = input;
    const wantParticles = input.visible.particles && input.windGrid !== null;
    const sliceKey = wantParticles && input.windGrid ? `${input.windGrid.retrievedAt}|${input.windGrid.level}|${input.timeISO}` : '';
    if (sliceKey !== this.sliceKey) {
      this.sliceKey = sliceKey;
      this.slice = wantParticles && input.windGrid ? windSlice(input.windGrid, input.timeISO) : null;
      if (this.slice && this.particles.capacity === 0) this.onViewChange();
    }
    this.buildHaze();
    this.buildCities();
    this.buildStreaks();
    this.syncLoop();
    if (!this.raf) this.render();
  }

  /** Remove the overlay and stop any animation loop. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.map.off('movestart', this.onMoveStart);
    this.map.off('moveend', this.onMoveEnd);
    this.map.off('moveend', this.onViewChange);
    this.map.off('resize', this.onViewChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionQuery?.removeEventListener('change', this.onMotionPref);
    this.observer?.disconnect();
    try {
      this.overlay.onRemove();
    } catch {
      /* map already removed */
    }
    this.container?.remove();
    this.hazeCache.clear();
    if (this.hoveredId) this.map.getCanvas().style.cursor = '';
  }

  // --- view and lifecycle ------------------------------------------------------------------

  private readonly onViewChange = (): void => {
    if (this.destroyed) return;
    const b = this.map.getBounds();
    const view: ParticleBox = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const box = intersectBox(view, GRID_BOX);
    this.box = box;
    let n = 0;
    if (box) {
      const a = this.map.project([box.west, box.north]);
      const c = this.map.project([box.east, box.south]);
      const area = Math.abs(c.x - a.x) * Math.abs(c.y - a.y);
      n = Math.min(MAX_PARTICLES, Math.round(area / PX_PER_PARTICLE));
    }
    this.areaCount = n;
    const cap = this.particles.capacity;
    if (Math.abs(n - cap) > cap * 0.15 || n === 0 || cap === 0) {
      this.particles.reset(n, box);
      const segs = n * TRAIL;
      this.segBufs = [0, 1].map(() => ({ from: new Float32Array(segs * 2), to: new Float32Array(segs * 2), color: new Uint8Array(segs * 4) }));
    } else if (box) {
      this.particles.recycleOutside(box);
    }
    this.particles.setActive(Math.min(n, this.budget.value), box);
    this.streakKey = '';
    this.buildStreaks();
    // City labels are placed in screen space: re-place them for the new view.
    this.viewSeq += 1;
    this.syncLoop();
    if (!this.raf) this.render();
  };

  /**
   * A pan or zoom pauses the particle step and the layer rebuilds. During a gesture the overlay still redraws
   * every map frame (deck follows the camera), so the trails stay on the map, pinned to their places; what
   * stops is the per-frame simulation and buffer upload that competed with the map for each frame. The
   * adaptive particle budget also stops sampling, so a zoom's own frame times never cut the particle count.
   */
  private readonly onMoveStart = (): void => {
    this.cameraMoving = true;
  };

  private readonly onMoveEnd = (): void => {
    this.cameraMoving = false;
    // Restart the clocks so the first step after the gesture is not one long jump.
    this.lastT = 0;
    this.lastRawT = 0;
  };

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    this.syncLoop();
  };

  private readonly onMotionPref = (e: MediaQueryListEvent): void => {
    this.reduced = e.matches;
    this.streakKey = '';
    this.buildStreaks();
    this.syncLoop();
    if (!this.raf) this.render();
  };

  /** Particles move only when they are on, some grid is in view, and motion is allowed. */
  private particlesOn(): boolean {
    const i = this.input;
    return Boolean(i && i.visible.particles && this.slice && this.box && this.particles.capacity > 0 && !this.reduced);
  }

  /** The worst city's pulse runs while the cities are shown and motion is allowed. */
  private pulsing(): boolean {
    return Boolean(this.input?.visible.cities && this.worst && !this.reduced);
  }

  private fading(): boolean {
    return this.prevHaze !== null && performance.now() - this.fadeStart < HAZE_FADE_MS;
  }

  /** Animate (particles, the pulse, a haze cross-fade) only while the map is visible on screen. */
  private animating(): boolean {
    return Boolean(!this.destroyed && this.input && !this.hidden && this.onScreen && (this.particlesOn() || this.pulsing() || this.fading()));
  }

  private syncLoop(): void {
    if (this.animating()) {
      if (!this.raf) {
        this.lastT = 0;
        this.lastRawT = 0;
        this.limiter.reset();
        this.raf = requestAnimationFrame(this.frame);
      }
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private readonly frame = (t: number): void => {
    this.raf = 0;
    if (!this.animating()) return;
    if (this.cameraMoving) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const moving = this.particlesOn() && this.slice !== null && this.box !== null;
    // Raw rAF interval feeds the adaptive budget; it sees real jank, not our 30 fps cap.
    if (moving && this.lastRawT && this.box) {
      const want = Math.min(this.areaCount, this.budget.record(t - this.lastRawT));
      if (want !== this.particles.count) this.particles.setActive(want, this.box);
    }
    this.lastRawT = t;
    if (this.prevHaze && !this.fading()) this.prevHaze = null;
    if (this.limiter.shouldRender(t)) {
      const dt = this.lastT ? Math.min(0.1, Math.max(0, (t - this.lastT) / 1000)) : 1 / PARTICLE_FPS;
      this.lastT = t;
      if (moving && this.slice && this.box) {
        const degPerPx = 360 / (512 * 2 ** this.map.getZoom());
        this.particles.step(this.slice, this.box, degPerPx, PX_PER_S_PER_MS * dt);
      }
      this.render();
      this.fpsCount += 1;
      if (t - this.fpsT >= 1000) {
        this.fps = Math.round((this.fpsCount * 1000) / (t - this.fpsT || 1000));
        this.fpsCount = 0;
        this.fpsT = t;
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Live particles after the adaptive budget (diagnostics). */
  get particleBudget(): number {
    return this.budget.value;
  }

  // --- layers --------------------------------------------------------------------------------

  private buildHaze(): void {
    const i = this.input;
    const aq = i?.airQuality ?? null;
    if (!i || !aq || !i.visible.haze) {
      this.hazeLayer = null;
      this.hazeImg = null;
      this.prevHaze = null;
      this.hazeKey = '';
      return;
    }
    const key = `${aq.retrievedAt}|${i.timeISO}|${i.dark ? 'd' : 'l'}`;
    if (key === this.hazeKey && this.hazeLayer) return;
    // A new forecast hour fades in over the last one (same run and theme only; instant when reduced).
    const sameRun = this.hazeKey.split('|')[0] === aq.retrievedAt && this.hazeKey.endsWith(i.dark ? 'd' : 'l');
    if (this.hazeImg && sameRun && !this.reduced) {
      this.prevHaze = this.hazeImg;
      this.fadeStart = performance.now();
    } else {
      this.prevHaze = null;
    }
    this.hazeKey = key;
    let img = this.hazeCache.get(key);
    if (!img) {
      const r = rasterisePm25(pm25Slice(aq, i.timeISO), aq.lats, aq.lons, i.dark);
      const canvas = document.createElement('canvas');
      canvas.width = r.width;
      canvas.height = r.height;
      canvas.getContext('2d')?.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
      img = { canvas, bounds: r.bounds };
      if (this.hazeCache.size > 60) this.hazeCache.clear();
      this.hazeCache.set(key, img);
    }
    this.hazeImg = { image: img.canvas, bounds: img.bounds };
    this.hazeLayer = new BitmapLayer({
      id: 'haze-pm25-modelled',
      image: img.canvas,
      bounds: img.bounds,
      pickable: false,
      textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    });
  }

  private cityData(): HazeCity[] {
    const aq = this.input?.airQuality;
    if (!aq) return [];
    const t = this.input!.timeISO;
    return aq.places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, pm25: placePm25At(aq, p, t) }));
  }

  private buildCities(): void {
    const i = this.input;
    if (!i || !i.airQuality || !i.visible.cities) {
      this.cityLayers = [];
      this.cityKey = '';
      return;
    }
    const zoomed = this.map.getZoom() >= LABEL_ZOOM;
    const nea = i.neaHaze ?? null;
    const zoom = this.map.getZoom();
    const planKey = i.labels ? [...i.labels].map(([k, v]) => `${k}=${v}`).join(',') : '';
    const key = [i.airQuality.retrievedAt, i.timeISO, i.dark, zoomed, this.viewSeq, this.hoveredId, i.selectedCityId, nea?.observedAt, nea?.dataMode, planKey].join('|');
    if (key === this.cityKey) return;
    this.cityKey = key;
    const dark = i.dark;
    const pal = paletteOf(i);
    // HazeView-style circles: radius grows with the square root of PM2.5 (6 to 26 px), a little larger in focus.
    // A little smaller at the regional zoom, so dense clusters read (cityMarkers.cityZoomScale).
    const radius = (d: HazeCity) => cityMarkerRadius(d.pm25, zoom, d.kind, d.id === i.selectedCityId || d.id === this.hoveredId);
    // Cities on top; at the regional zoom a fire-area circle that overlaps a city's is left out, so a click on
    // "Palangka Raya 407" opens Palangka Raya, not the fire-area town drawn over it (cityDrawOrder).
    const data = cityDrawOrder(
      this.cityData(),
      (d) => {
        const pt = this.map.project([d.lon, d.lat]);
        return { x: pt.x, y: pt.y, r: radius(d) };
      },
      !zoomed,
    );
    const worst = worstId(data);
    const worstCity = worst ? (data.find((d) => d.id === worst) ?? null) : null;
    const bandRgb = (d: HazeCity): Rgb => {
      const b = pm25Band(d.pm25);
      return b ? hexRgb(b.color) : [150, 150, 150];
    };
    const focus = (d: HazeCity) => d.id === i.selectedCityId || d.id === this.hoveredId;
    const onClick = (info: PickingInfo<HazeCity>) => {
      if (info.object) this.input?.onCityClick?.(info.object, { x: info.x, y: info.y });
      return true;
    };
    const onHover = (info: PickingInfo<HazeCity>) => {
      const id = info.object?.id ?? null;
      if (id === this.hoveredId) return;
      this.hoveredId = id;
      this.map.getCanvas().style.cursor = id ? 'pointer' : '';
      this.buildCities();
      if (!this.raf) this.render();
    };
    this.worst = worstCity ? { id: worstCity.id, lon: worstCity.lon, lat: worstCity.lat, r: radius(worstCity), rgb: bandRgb(worstCity) } : null;
    // Every circle carries its value; names are added where they fit (worst first, no overlaps).
    let labelOf: Map<string, { text: string; kind: 'full' | 'value' }>;
    if (i.labels) {
      // The map's shared plan (pins, volcano names, worst cities, fire badges, other cities); a hovered city
      // always gets its full label.
      labelOf = new Map([...i.labels].map(([id, text]) => [id, { text, kind: text.includes('  ') ? ('full' as const) : ('value' as const) }]));
      const hovered = this.hoveredId ? data.find((d) => d.id === this.hoveredId) : null;
      if (hovered) labelOf.set(hovered.id, { text: `${shortCityName(hovered.name)}  ${valueText(hovered.pm25)}`, kind: 'full' });
    } else {
      const { width: vw, height: vh } = this.map.getContainer().getBoundingClientRect();
      const placed = placeCityLabels(
        data.map((d) => {
          const pt = this.map.project([d.lon, d.lat]);
          return { id: d.id, x: pt.x, y: pt.y, r: radius(d), name: shortCityName(d.name), value: valueText(d.pm25), priority: Number.isFinite(d.pm25) ? d.pm25 : -1, force: focus(d) };
        }),
        { charPx: 7.2, heightPx: 16, gapPx: 6, viewport: { w: vw, h: vh } },
      );
      labelOf = new Map(placed.map((l) => [l.id, l]));
    }
    const labelled = data.filter((d) => labelOf.has(d.id));
    const showLabel = (d: HazeCity) => zoomed || focus(d) || labelOf.get(d.id)?.kind === 'full';
    const sg = data.find((d) => d.id === SINGAPORE_ID);
    const psiValues = nea ? Object.values(nea.psi24h).filter((v) => Number.isFinite(v)) : [];
    const psiMax = psiValues.length ? Math.max(...psiValues) : null;
    const neaText =
      nea && psiMax !== null
        ? `NEA MEASURED 24-h PSI ${psiMax} (${nea.psiBand}) · ${nea.dataMode === 'historical' ? 'SNAPSHOT' : 'LIVE'} ${hhmm(nea.observedAt)} UTC`
        : null;
    const font = "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";
    const layers: Layer[] = [];
    {
      // Soft glow under each dot: a radial-gradient sprite tinted by band; additive on the dark map, a
      // normally blended band-tinted aura on the light map (additive glows vanish on white).
      layers.push(
        new IconLayer<HazeCity>({
          id: 'haze-city-glow',
          data,
          iconAtlas: glowSprite(),
          iconMapping: { glow: { x: 0, y: 0, width: GLOW_PX, height: GLOW_PX, mask: true } },
          getIcon: () => 'glow',
          getPosition: (d) => [d.lon, d.lat],
          sizeUnits: 'pixels',
          // The sprite's visible glow reaches about a third of its size: about 3.4 radii keeps it hugging the circle.
          getSize: (d) => radius(d) * 3.4,
          getColor: (d) => [...bandRgb(d), focus(d) ? pal.city.glowAlpha.focus : pal.city.glowAlpha.rest],
          parameters: pal.city.glowBlend === 'additive' ? ADDITIVE : undefined,
          updateTriggers: {
            getColor: [i.timeISO, i.airQuality.retrievedAt, this.hoveredId, i.selectedCityId, dark],
            getSize: [i.timeISO, i.airQuality.retrievedAt, this.hoveredId, i.selectedCityId],
          },
        }),
      );
    }
    if (sg && neaText) {
      // Measured (NEA) ring around Singapore's modelled dot: a second cue in the NEA chip's colours.
      layers.push(
        new ScatterplotLayer<HazeCity>({
          id: 'haze-nea-ring',
          data: [sg],
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: (d) => radius(d) + 4,
          filled: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getLineColor: pal.city.neaRing,
          updateTriggers: { getLineColor: [dark], getRadius: [i.timeISO, i.airQuality.retrievedAt, this.hoveredId, i.selectedCityId] },
        }),
      );
    }
    layers.push(
      new ScatterplotLayer<HazeCity>({
        id: 'haze-cities-modelled',
        data,
        pickable: true,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: 'pixels',
        getRadius: radius,
        filled: true,
        stroked: true,
        lineWidthUnits: 'pixels',
        // Light map: an ink outline carries the edge (pale band fills are < 3:1 on white). Dark: a dark rim, as HazeView.
        getLineWidth: (d) => (d.kind === 'fire-area' ? 2 : focus(d) ? 2.5 : dark ? 2 : 1.5),
        getFillColor: (d) => [...bandRgb(d), 255],
        getLineColor: (d) => (d.kind === 'fire-area' ? pal.city.fireAreaOutline : cityBandStyle(pal, d.pm25).outline),
        updateTriggers: {
          getFillColor: [i.timeISO, i.airQuality.retrievedAt],
          getLineColor: [dark, i.timeISO],
          getLineWidth: [dark, this.hoveredId, i.selectedCityId],
          getRadius: [i.timeISO, i.airQuality.retrievedAt, this.hoveredId, i.selectedCityId],
        },
        onClick,
        onHover,
      }),
    );
    // "Palangka Raya  719" right of the circle (the value alone where the name would collide). Modelled
    // values: the scrubber and every card say MODELLED; the circle label stays short, as on HazeView.
    const labelText = (d: HazeCity) => labelOf.get(d.id)?.text ?? valueText(d.pm25);
    if (labelled.length) {
      // Labels with an SDF halo in both themes: cream on a dark halo, ink on a white halo (>= 4.5:1 on any
      // map colour under the halo; mapPalette `label`).
      layers.push(
        new TextLayer<HazeCity>({
          id: 'haze-city-labels',
          data: labelled,
          characterSet: 'auto',
          fontFamily: font,
          fontWeight: 600,
          fontSettings: { sdf: true, fontSize: 64, buffer: 6, radius: 16 },
          outlineWidth: pal.label.haloWidth,
          outlineColor: pal.label.halo,
          getPosition: (d) => [d.lon, d.lat],
          getText: labelText,
          getSize: (d) => (focus(d) || d.id === worst ? 13.5 : 12.5),
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          getPixelOffset: (d) => [radius(d) + 6, 0],
          getColor: pal.label.text,
          updateTriggers: {
            getText: [i.timeISO, this.viewSeq, this.hoveredId, i.selectedCityId],
            getColor: [dark],
            getSize: [i.timeISO, this.hoveredId, i.selectedCityId],
            getPixelOffset: [i.timeISO, this.hoveredId, i.selectedCityId],
          },
        }),
      );
    }
    if (sg && neaText && showLabel(sg)) {
      layers.push(
        new TextLayer<HazeCity>({
          id: 'haze-nea-label',
          data: [sg],
          characterSet: 'auto',
          fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace",
          fontWeight: 600,
          getPosition: (d) => [d.lon, d.lat],
          getText: () => neaText,
          getSize: 11.5,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          getPixelOffset: (d) => [0, radius(d) + 8],
          getColor: pal.city.neaChip.text,
          background: true,
          getBackgroundColor: pal.city.neaChip.bg,
          backgroundPadding: [5, 3],
          updateTriggers: { getText: [neaText], getColor: [dark], getBackgroundColor: [dark] },
        }),
      );
    }
    this.cityLayers = layers;
  }

  private buildStreaks(): void {
    const i = this.input;
    if (!i || !this.reduced || !i.visible.particles || !this.slice || !this.box) {
      this.streakLayer = null;
      this.streakKey = '';
      return;
    }
    const zoom = this.map.getZoom();
    const key = `${this.sliceKey}|${zoom.toFixed(2)}|${this.box.west.toFixed(3)},${this.box.south.toFixed(3)},${this.box.east.toFixed(3)},${this.box.north.toFixed(3)}|${i.dark}`;
    if (key === this.streakKey) return;
    this.streakKey = key;
    const degPerPx = 360 / (512 * 2 ** zoom);
    const paths = streakArrows(this.slice, this.box, 52 * degPerPx, 5 * degPerPx, 5);
    this.streakLayer = new PathLayer<[number, number][]>({
      id: 'haze-wind-streaks',
      data: paths,
      getPath: (d) => d,
      widthUnits: 'pixels',
      getWidth: 1.4,
      jointRounded: true,
      capRounded: true,
      getColor: [...paletteOf(i).particles.color, Math.round(paletteOf(i).particles.streakAlpha * 255)],
      updateTriggers: { getColor: [i.dark] },
    });
  }

  private particleLayers(): Layer[] {
    const i = this.input;
    if (!i || !i.visible.particles || this.reduced || !this.slice || this.particles.count === 0) return [];
    const pp = paletteOf(i).particles;
    const rgb: Rgb = pp.color;
    // Alternate two same-size buffer sets: deck.gl re-uploads an external buffer only when its reference
    // changes, and a constant size avoids reallocating GPU buffers every frame.
    this.segFlip ^= 1;
    const buf = this.segBufs[this.segFlip];
    if (!buf) return [];
    const drawTrail = trailForZoom(this.map.getZoom(), TRAIL);
    const visible = this.particles.segments(buf, rgb, pp.alpha, SEG_ORIGIN, drawTrail);
    if (visible === 0) return [];
    const data = {
      length: this.particles.count * drawTrail,
      attributes: {
        getSourcePosition: { value: buf.from, size: 2 },
        getTargetPosition: { value: buf.to, size: 2 },
        getColor: { value: buf.color, size: 4, normalized: true },
      },
    } as never;
    const common = {
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
      coordinateOrigin: [SEG_ORIGIN[0], SEG_ORIGIN[1], 0] as [number, number, number],
      data,
      widthUnits: 'pixels' as const,
      parameters: pp.blend === 'additive' ? ADDITIVE : undefined,
      pickable: false,
    };
    // Two passes over the same buffers: a wide faint glow under a crisp core trail (HazeView's flow).
    return [
      new LineLayer({ ...common, id: 'haze-wind-particles-glow', getWidth: pp.width * TRAIL_GLOW.width, opacity: TRAIL_GLOW.opacity }),
      new LineLayer({ ...common, id: 'haze-wind-particles', getWidth: pp.width }),
    ];
  }

  /** The haze image(s): the new hour fading in over the previous one. */
  private hazeLayers(): Layer[] {
    if (!this.hazeImg) return [];
    const f = this.prevHaze ? Math.min(1, (performance.now() - this.fadeStart) / HAZE_FADE_MS) : 1;
    const out: Layer[] = [];
    if (this.prevHaze && f < 1) {
      out.push(
        new BitmapLayer({
          id: 'haze-pm25-modelled-prev',
          image: this.prevHaze.image,
          bounds: this.prevHaze.bounds,
          opacity: 1 - f,
          pickable: false,
          textureParameters: { minFilter: 'linear', magFilter: 'linear' },
        }),
      );
    }
    out.push(
      f >= 1 && this.hazeLayer
        ? this.hazeLayer
        : new BitmapLayer({
            id: 'haze-pm25-modelled',
            image: this.hazeImg.image,
            bounds: this.hazeImg.bounds,
            opacity: f,
            pickable: false,
            textureParameters: { minFilter: 'linear', magFilter: 'linear' },
          }),
    );
    return out;
  }

  /** A slow ring that grows out of the worst city and fades (HazeView's pulse); off under reduced motion. */
  private pulseLayer(): Layer | null {
    const w = this.worst;
    if (!w || !this.pulsing()) return null;
    const ring = pulseRing(w.r, performance.now());
    return new ScatterplotLayer<{ p: [number, number] }>({
      id: 'haze-worst-pulse',
      data: [{ p: [w.lon, w.lat] }],
      getPosition: (d) => d.p,
      radiusUnits: 'pixels',
      getRadius: ring.radius,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: [...w.rgb, ring.alpha],
      pickable: false,
      updateTriggers: { getRadius: [ring.radius], getLineColor: [ring.alpha, w.rgb.join(',')] },
    });
  }

  private render(): void {
    if (this.destroyed) return;
    // Labels depend on zoom; rebuild cheaply when the threshold is crossed (key-guarded).
    this.buildCities();
    const layers: Layer[] = [...this.hazeLayers(), ...this.particleLayers()];
    if (this.streakLayer) layers.push(this.streakLayer);
    const pulse = this.pulseLayer();
    if (pulse) layers.push(pulse);
    layers.push(...this.cityLayers);
    this.overlay.setProps({ layers });
  }
}
