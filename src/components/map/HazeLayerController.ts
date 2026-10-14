// Haze layer controller (haze agent). MapView only calls the public surface: constructor(map),
// update(input), destroy(). Draws on its OWN deck.gl overlay (overlaid mode, its own canvas), so it never
// fights MapView's overlay for layer ownership and survives basemap style switches (dark/light) untouched.
//   - Modelled PM2.5 haze (CAMS via Open-Meteo): a BitmapLayer from a bilinear raster with a smoke ramp.
//   - Modelled 925 hPa wind particles (Open-Meteo): its own requestAnimationFrame loop calling
//     overlay.setProps with a LineLayer of trail segments (binary attributes, no React per frame). Paused
//     when the tab is hidden or the map is off-screen; static streak arrows under prefers-reduced-motion.
//     Particle count scales with the visible grid area (CPU cap).
//   - City markers coloured by EPA-style PM2.5 band (MODELLED), labels on hover or when zoomed in;
//     Singapore also shows NEA MEASURED 24-h PSI with its LIVE/SNAPSHOT tag in a visibly different chip.
// The overlay's container is placed directly above the map canvas (below MapLibre markers, popups and
// controls, and below any overlay MapView adds as a control), so haze never tints MapView's markers.
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { HazeReading } from '../../types';
import { pm25Band, pm25Slice, placePm25At } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import { WIND_GRID_SPEC, windSlice } from '../../lib/windField';
import type { WindGrid, WindSlice } from '../../lib/windField';
import { intersectBox, ParticleSystem, rasterisePm25, streakArrows } from './hazeRender';
import type { ParticleBox } from './hazeRender';

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
}

const GRID_BOX: ParticleBox = {
  west: WIND_GRID_SPEC.minLon,
  south: WIND_GRID_SPEC.minLat,
  east: WIND_GRID_SPEC.maxLon,
  north: WIND_GRID_SPEC.maxLat,
};
/** One particle per this many visible grid pixels, capped. */
const PX_PER_PARTICLE = 300;
const MAX_PARTICLES = 3500;
const TRAIL = 6;
/** Screen pixels per second per m/s of wind. */
const PX_PER_S_PER_MS = 6;
/** MapLibre zoom from which every city label shows. */
const LABEL_ZOOM = 6;
const SINGAPORE_ID = 'singapore';

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

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
  private readonly hazeCache = new Map<string, { canvas: HTMLCanvasElement; bounds: [number, number, number, number] }>();
  private cityLayers: Layer[] = [];
  private cityKey = '';
  private streakLayer: Layer | null = null;
  private streakKey = '';
  private hoveredId: string | null = null;

  private readonly particles = new ParticleSystem(TRAIL);
  private box: ParticleBox | null = null;
  private seg = { from: new Float64Array(0), to: new Float64Array(0), color: new Uint8Array(0) };
  private raf = 0;
  private lastT = 0;
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
      if (this.slice && this.particles.count === 0) this.onViewChange();
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
    if (Math.abs(n - this.particles.count) > this.particles.count * 0.15 || n === 0 || this.particles.count === 0) {
      this.particles.reset(n, box);
      const segs = n * TRAIL;
      this.seg = { from: new Float64Array(segs * 2), to: new Float64Array(segs * 2), color: new Uint8Array(segs * 4) };
    } else if (box) {
      this.particles.recycleOutside(box);
    }
    this.streakKey = '';
    this.buildStreaks();
    this.syncLoop();
    if (!this.raf) this.render();
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

  private animating(): boolean {
    const i = this.input;
    return Boolean(
      !this.destroyed && i && i.visible.particles && this.slice && this.box && this.particles.count > 0 && !this.reduced && !this.hidden && this.onScreen,
    );
  }

  private syncLoop(): void {
    if (this.animating()) {
      if (!this.raf) {
        this.lastT = 0;
        this.raf = requestAnimationFrame(this.frame);
      }
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private readonly frame = (t: number): void => {
    this.raf = 0;
    if (!this.animating() || !this.slice || !this.box) return;
    const dt = this.lastT ? Math.min(0.05, Math.max(0, (t - this.lastT) / 1000)) : 1 / 60;
    this.lastT = t;
    const degPerPx = 360 / (512 * 2 ** this.map.getZoom());
    this.particles.step(this.slice, this.box, degPerPx, PX_PER_S_PER_MS * dt);
    this.render();
    this.fpsCount += 1;
    if (t - this.fpsT >= 1000) {
      this.fps = Math.round((this.fpsCount * 1000) / (t - this.fpsT || 1000));
      this.fpsCount = 0;
      this.fpsT = t;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // --- layers --------------------------------------------------------------------------------

  private buildHaze(): void {
    const i = this.input;
    const aq = i?.airQuality ?? null;
    if (!i || !aq || !i.visible.haze) {
      this.hazeLayer = null;
      this.hazeKey = '';
      return;
    }
    const key = `${aq.retrievedAt}|${i.timeISO}|${i.dark ? 'd' : 'l'}`;
    if (key === this.hazeKey && this.hazeLayer) return;
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
    const key = [i.airQuality.retrievedAt, i.timeISO, i.dark, zoomed, this.hoveredId, i.selectedCityId, nea?.observedAt, nea?.dataMode].join('|');
    if (key === this.cityKey) return;
    this.cityKey = key;
    const dark = i.dark;
    const data = this.cityData();
    const halo: Rgba = dark ? [14, 17, 22, 255] : [255, 255, 255, 255];
    const fill = (d: HazeCity): Rgba => {
      const b = pm25Band(d.pm25);
      return b ? [...hexRgb(b.color), 255] : [128, 128, 128, 255];
    };
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
    const showLabel = (d: HazeCity) => zoomed || d.id === this.hoveredId || d.id === i.selectedCityId;
    const labelled = data.filter(showLabel);
    const sg = data.find((d) => d.id === SINGAPORE_ID);
    const psiValues = nea ? Object.values(nea.psi24h).filter((v) => Number.isFinite(v)) : [];
    const psiMax = psiValues.length ? Math.max(...psiValues) : null;
    const neaText =
      nea && psiMax !== null
        ? `NEA MEASURED 24-h PSI ${psiMax} (${nea.psiBand}) · ${nea.dataMode === 'historical' ? 'SNAPSHOT' : 'LIVE'} ${hhmm(nea.observedAt)} UTC`
        : null;
    const font = "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";
    const layers: Layer[] = [];
    if (sg && neaText) {
      // Measured (NEA) ring around Singapore's modelled dot: a second, square-cornered cue in NEA ink.
      layers.push(
        new ScatterplotLayer<HazeCity>({
          id: 'haze-nea-ring',
          data: [sg],
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: 'pixels',
          getRadius: 11,
          filled: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2.5,
          getLineColor: dark ? [255, 210, 122, 255] : [20, 26, 34, 255],
          updateTriggers: { getLineColor: [dark] },
        }),
      );
    }
    layers.push(
      new ScatterplotLayer<HazeCity>({
        id: 'haze-cities-modelled',
        data,
        pickable: true,
        autoHighlight: false,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: 'pixels',
        getRadius: (d) => (d.id === i.selectedCityId || d.id === this.hoveredId ? 8 : d.kind === 'fire-area' ? 5 : 6.5),
        filled: true,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (d) => (d.kind === 'fire-area' ? 2.5 : 1.5),
        getFillColor: fill,
        getLineColor: (d) => (d.kind === 'fire-area' ? (dark ? [255, 170, 90, 255] : [110, 52, 18, 255]) : halo),
        updateTriggers: { getFillColor: [i.timeISO, i.airQuality.retrievedAt], getLineColor: [dark], getRadius: [this.hoveredId, i.selectedCityId] },
        onClick,
        onHover,
      }),
    );
    if (labelled.length) {
      layers.push(
        new TextLayer<HazeCity>({
          id: 'haze-city-labels',
          data: labelled,
          characterSet: 'auto',
          fontFamily: font,
          fontWeight: 600,
          getPosition: (d) => [d.lon, d.lat],
          getText: (d) => `${d.name}${d.kind === 'fire-area' ? ' · fire-prone area' : ''}\nPM2.5 ${Math.round(d.pm25)} µg/m³ (modelled)`,
          getSize: 12,
          lineHeight: 1.25,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: [0, -12],
          getColor: dark ? [236, 239, 243, 255] : [20, 26, 34, 255],
          background: true,
          getBackgroundColor: dark ? [22, 26, 33, 236] : [255, 255, 255, 240],
          getBorderColor: dark ? [90, 100, 114, 255] : [127, 138, 152, 255],
          getBorderWidth: 1,
          backgroundPadding: [5, 3],
          updateTriggers: { getText: [i.timeISO], getColor: [dark], getBackgroundColor: [dark], getBorderColor: [dark] },
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
          getPixelOffset: [0, 14],
          getColor: dark ? [20, 26, 34, 255] : [255, 210, 122, 255],
          background: true,
          getBackgroundColor: dark ? [255, 210, 122, 245] : [20, 26, 34, 242],
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
      getColor: i.dark ? [238, 232, 218, 190] : [36, 48, 66, 170],
      updateTriggers: { getColor: [i.dark] },
    });
  }

  private particleLayer(): Layer | null {
    const i = this.input;
    if (!i || !i.visible.particles || this.reduced || !this.slice || this.particles.count === 0) return null;
    const rgb: Rgb = i.dark ? [238, 232, 218] : [36, 48, 66];
    const n = this.particles.segments(this.seg, rgb, i.dark ? 0.8 : 0.62);
    if (n === 0) return null;
    // Fresh subarray views each frame: deck.gl re-uploads an external buffer only when its reference changes.
    const data = {
      length: n,
      attributes: {
        getSourcePosition: { value: this.seg.from.subarray(0, n * 2), size: 2 },
        getTargetPosition: { value: this.seg.to.subarray(0, n * 2), size: 2 },
        getColor: { value: this.seg.color.subarray(0, n * 4), size: 4, normalized: true },
      },
    };
    return new LineLayer({
      id: 'haze-wind-particles',
      data: data as never,
      widthUnits: 'pixels',
      getWidth: 1.3,
      pickable: false,
    });
  }

  private render(): void {
    if (this.destroyed) return;
    // Labels depend on zoom; rebuild cheaply when the threshold is crossed (key-guarded).
    this.buildCities();
    const layers: Layer[] = [];
    if (this.hazeLayer) layers.push(this.hazeLayer);
    const p = this.particleLayer();
    if (p) layers.push(p);
    if (this.streakLayer) layers.push(this.streakLayer);
    layers.push(...this.cityLayers);
    this.overlay.setProps({ layers });
  }
}
