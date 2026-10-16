// Pure helpers for the haze controller (no DOM, no deck.gl): the smoke colour ramp, the PM2.5 raster
// (bilinear on the 1° grid, rows in Web Mercator so a BitmapLayer quad places it exactly) and a small
// particle system advected by a 925 hPa wind slice. MODELLED context only.
import { sampleRegular, sampleSlice } from '../../lib/windField';
import type { WindSlice } from '../../lib/windField';
import { getMapPalette, rampRgba } from './mapPalette';
import type { MapTheme, Rgba } from './mapPalette';

export type { Rgba };

/**
 * Smoke colour for a PM2.5 value from the theme's haze ramp (mapPalette): transparent when clean; a tan
 * smoke on the dark map, amber to deep brown on the light map. `theme` also accepts the older
 * `dark: boolean` flag; it defaults to dark.
 */
export function smokeRgba(v: number, theme: MapTheme | boolean = 'dark'): Rgba {
  return rampRgba(getMapPalette(theme).haze.stops, v);
}

const mercY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
const invMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

export interface HazeRaster {
  width: number;
  height: number;
  /** RGBA, row 0 at the north edge. */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** [west, south, east, north] degrees, for BitmapLayer `bounds`. */
  bounds: [number, number, number, number];
}

/**
 * Rasterise a PM2.5 slice (row-major on ascending lats/lons) into RGBA. Rows are evenly spaced in
 * Web Mercator y so a BitmapLayer quad is exact. The outer `featherDeg` fades to transparent so the
 * grid box never shows a hard edge.
 */
export function rasterisePm25(
  slice: ArrayLike<number>,
  lats: readonly number[],
  lons: readonly number[],
  theme: MapTheme | boolean = 'dark',
  opts: { pxPerDeg?: number; featherDeg?: number } = {},
): HazeRaster {
  const pxPerDeg = opts.pxPerDeg ?? 10;
  const feather = opts.featherDeg ?? 1.5;
  const west = lons[0];
  const east = lons[lons.length - 1];
  const south = lats[0];
  const north = lats[lats.length - 1];
  const width = Math.max(2, Math.round((east - west) * pxPerDeg));
  const height = Math.max(2, Math.round((north - south) * pxPerDeg));
  const data = new Uint8ClampedArray(width * height * 4);
  const yN = mercY(north);
  const yS = mercY(south);
  for (let r = 0; r < height; r += 1) {
    const lat = invMercY(yN + ((r + 0.5) / height) * (yS - yN));
    const edgeLat = Math.min(lat - south, north - lat);
    for (let c = 0; c < width; c += 1) {
      const lon = west + ((c + 0.5) / width) * (east - west);
      const v = sampleRegular(slice, lats, lons, lat, lon);
      const [cr, cg, cb, ca] = smokeRgba(v, theme);
      const edge = Math.min(edgeLat, lon - west, east - lon);
      const fade = feather > 0 ? Math.max(0, Math.min(1, edge / feather)) : 1;
      const o = (r * width + c) * 4;
      data[o] = cr;
      data[o + 1] = cg;
      data[o + 2] = cb;
      data[o + 3] = Math.round(ca * fade * fade * (3 - 2 * fade)); // smoothstep edge fade
    }
  }
  return { width, height, data, bounds: [west, south, east, north] };
}

// ---------------------------------------------------------------------------
// Particles: positions in degrees, advected at a constant on-screen speed per m/s (so motion reads at
// any zoom), with a short ring-buffer history for the trail segments.

export interface ParticleBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export class ParticleSystem {
  readonly trail: number;
  count = 0;
  /** History ring buffer: [particle][slot][lon, lat]. */
  hist = new Float64Array(0);
  age = new Uint16Array(0);
  maxAge = new Uint16Array(0);
  /** Speed (m/s) at the latest step, for colour/alpha. */
  speed = new Float32Array(0);
  head = 0;
  private rand: () => number;

  constructor(trail = 6, rand: () => number = Math.random) {
    this.trail = trail;
    this.rand = rand;
  }

  /** Resize to `n` particles and seed them all inside `box`. */
  reset(n: number, box: ParticleBox | null): void {
    const slots = this.trail + 1;
    this.count = box ? Math.max(0, Math.floor(n)) : 0;
    this.hist = new Float64Array(this.count * slots * 2);
    this.age = new Uint16Array(this.count);
    this.maxAge = new Uint16Array(this.count);
    this.speed = new Float32Array(this.count);
    this.head = 0;
    if (box) for (let p = 0; p < this.count; p += 1) this.respawn(p, box, true);
  }

  /** Allocated particles (the most `setActive` can turn on without a reset). */
  get capacity(): number {
    return this.age.length;
  }

  /** Change the number of live particles within capacity; newly enabled ones spawn inside `box`. */
  setActive(n: number, box: ParticleBox | null): void {
    const next = box ? Math.max(0, Math.min(this.capacity, Math.floor(n))) : 0;
    if (box) for (let p = this.count; p < next; p += 1) this.respawn(p, box, true);
    this.count = next;
  }

  /** Put particle `p` at a random point in `box`, collapsing its trail. */
  respawn(p: number, box: ParticleBox, randomAge = false): void {
    const slots = this.trail + 1;
    const lon = box.west + this.rand() * (box.east - box.west);
    const lat = box.south + this.rand() * (box.north - box.south);
    const base = p * slots * 2;
    for (let s = 0; s < slots; s += 1) {
      this.hist[base + s * 2] = lon;
      this.hist[base + s * 2 + 1] = lat;
    }
    this.maxAge[p] = 50 + Math.floor(this.rand() * 70);
    this.age[p] = randomAge ? Math.floor(this.rand() * this.maxAge[p]) : 0;
    this.speed[p] = 0;
  }

  /** Respawn every particle whose head lies outside `box`. */
  recycleOutside(box: ParticleBox): void {
    const slots = this.trail + 1;
    for (let p = 0; p < this.count; p += 1) {
      const o = (p * slots + this.head) * 2;
      const lon = this.hist[o];
      const lat = this.hist[o + 1];
      if (lon < box.west || lon > box.east || lat < box.south || lat > box.north) this.respawn(p, box);
    }
  }

  /**
   * Advance one step. `degPerPx` is degrees of longitude per screen pixel at the current zoom;
   * `pxPerMs` is screen pixels per (m/s) for this step (speed × dt).
   */
  step(slice: WindSlice, box: ParticleBox, degPerPx: number, pxPerMs: number): void {
    const slots = this.trail + 1;
    const next = (this.head + 1) % slots;
    for (let p = 0; p < this.count; p += 1) {
      const base = p * slots * 2;
      const o = base + this.head * 2;
      const lon = this.hist[o];
      const lat = this.hist[o + 1];
      this.age[p] += 1;
      const w = sampleSlice(slice, lat, lon);
      if (!w || this.age[p] > this.maxAge[p] || lon < box.west || lon > box.east || lat < box.south || lat > box.north) {
        this.respawn(p, box);
        // respawn wrote every slot, so the new head is consistent.
        continue;
      }
      const s = Math.hypot(w.u, w.v);
      this.speed[p] = s;
      const k = pxPerMs * degPerPx;
      this.hist[base + next * 2] = lon + w.u * k;
      this.hist[base + next * 2 + 1] = lat + w.v * k * Math.cos((lat * Math.PI) / 180);
    }
    this.head = next;
  }

  /**
   * Trail segments into fixed slots (particle p, segment k → slot p·drawTrail + k) for a deck.gl LineLayer
   * with binary attributes: from → to positions as (lon, lat) offsets from `origin` (Float32 is exact
   * enough for offsets; use COORDINATE_SYSTEM.LNGLAT_OFFSETS) and RGBA colours fading along the trail
   * and in/out with age. Every slot is written (unused ones get alpha 0), so the buffer size never
   * changes between frames. Returns the number of visible segments.
   */
  segments(
    out: { from: Float32Array | Float64Array; to: Float32Array | Float64Array; color: Uint8Array },
    rgb: [number, number, number],
    maxAlpha: number,
    origin: readonly [number, number] = [0, 0],
    drawTrail: number = this.trail,
  ): number {
    const slots = this.trail + 1;
    const segs = Math.max(1, Math.min(this.trail, Math.floor(drawTrail)));
    let visible = 0;
    for (let p = 0; p < this.count; p += 1) {
      const base = p * slots * 2;
      const lifeFade = Math.min(1, this.age[p] / 8, (this.maxAge[p] - this.age[p]) / 12);
      const speedA = Math.min(1, 0.35 + this.speed[p] / 12);
      for (let k = 0; k < segs; k += 1) {
        const n = p * segs + k;
        const a = (this.head - k + slots) % slots;
        const b = (this.head - k - 1 + slots) % slots;
        const x1 = this.hist[base + a * 2];
        const y1 = this.hist[base + a * 2 + 1];
        const x0 = this.hist[base + b * 2];
        const y0 = this.hist[base + b * 2 + 1];
        out.from[n * 2] = x0 - origin[0];
        out.from[n * 2 + 1] = y0 - origin[1];
        out.to[n * 2] = x1 - origin[0];
        out.to[n * 2 + 1] = y1 - origin[1];
        out.color[n * 4] = rgb[0];
        out.color[n * 4 + 1] = rgb[1];
        out.color[n * 4 + 2] = rgb[2];
        const show = lifeFade > 0 && k < this.age[p] && (x0 !== x1 || y0 !== y1);
        out.color[n * 4 + 3] = show ? Math.round(255 * maxAlpha * lifeFade * speedA * (1 - k / segs)) : 0;
        if (show) visible += 1;
      }
    }
    return visible;
  }
}

/** Intersection of two boxes, or null when they do not overlap. */
export function intersectBox(a: ParticleBox, b: ParticleBox): ParticleBox | null {
  const out = { west: Math.max(a.west, b.west), south: Math.max(a.south, b.south), east: Math.min(a.east, b.east), north: Math.min(a.north, b.north) };
  return out.east > out.west && out.north > out.south ? out : null;
}

/**
 * Static streak arrows for prefers-reduced-motion: a streamline of `steps` from each seed in `box`
 * (seeds every `spacingDeg`), plus a two-stroke arrowhead. Paths in [lon, lat].
 */
export function streakArrows(slice: WindSlice, box: ParticleBox, spacingDeg: number, stepDeg: number, steps = 5): [number, number][][] {
  const out: [number, number][][] = [];
  for (let lat = box.south + spacingDeg / 2; lat < box.north; lat += spacingDeg) {
    for (let lon = box.west + spacingDeg / 2; lon < box.east; lon += spacingDeg) {
      const line: [number, number][] = [[lon, lat]];
      let x = lon;
      let y = lat;
      let ux = 0;
      let uy = 0;
      for (let s = 0; s < steps; s += 1) {
        const w = sampleSlice(slice, y, x);
        if (!w) break;
        const sp = Math.hypot(w.u, w.v);
        if (sp < 0.2) break;
        const scale = Math.min(1.6, 0.5 + sp / 8);
        ux = w.u / sp;
        uy = w.v / sp;
        x += ux * stepDeg * scale;
        y += uy * stepDeg * scale;
        line.push([x, y]);
      }
      if (line.length < 3) continue;
      out.push(line);
      const h = stepDeg * 1.1;
      const back: [number, number] = [x - ux * h, y - uy * h];
      out.push([
        [back[0] - uy * h * 0.6, back[1] + ux * h * 0.6],
        [x, y],
        [back[0] + uy * h * 0.6, back[1] - ux * h * 0.6],
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frame pacing and adaptive particle budget (pure, unit-tested)

/** Caps an rAF loop at `fps`: shouldRender(t) is true on frames that keep a steady cadence at most `fps`. */
export class FrameLimiter {
  readonly intervalMs: number;
  private last = Number.NEGATIVE_INFINITY;

  constructor(fps: number) {
    this.intervalMs = 1000 / fps;
  }

  /** `t` is the rAF timestamp (ms). A 1 ms tolerance absorbs rAF jitter. */
  shouldRender(t: number): boolean {
    const elapsed = t - this.last;
    if (elapsed < this.intervalMs - 1) return false;
    // Advance on the cadence grid so 60 Hz gives exactly every second frame; resync after a long gap.
    this.last = elapsed > this.intervalMs * 3 ? t : this.last + this.intervalMs * Math.max(1, Math.floor(elapsed / this.intervalMs));
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

export interface BudgetOptions {
  min?: number;
  /** Frames per averaging window. */
  window?: number;
  /** Step down when the window's mean frame time is above this (ms). */
  slowMs?: number;
  /** Count a window as calm when its mean frame time is below this (ms). */
  fastMs?: number;
  down?: number;
  up?: number;
  /** Calm windows in a row before one step up (slow restore). */
  calmWindows?: number;
}

/**
 * Particle budget that steps down (×0.75) when the mean raw frame time over a window exceeds ~33 ms
 * and creeps back up (×1.15) only after several calm windows. Frame times above 1 s (tab switch,
 * breakpoint) are ignored.
 */
export class AdaptiveBudget {
  readonly max: number;
  readonly min: number;
  value: number;
  private readonly o: Required<Omit<BudgetOptions, 'min'>>;
  private sum = 0;
  private n = 0;
  private calm = 0;

  constructor(max: number, opts: BudgetOptions = {}) {
    this.max = max;
    this.min = Math.min(max, opts.min ?? 600);
    this.value = max;
    this.o = {
      window: opts.window ?? 30,
      slowMs: opts.slowMs ?? 36,
      fastMs: opts.fastMs ?? 22,
      down: opts.down ?? 0.75,
      up: opts.up ?? 1.15,
      calmWindows: opts.calmWindows ?? 4,
    };
  }

  /** Record one raw frame time (ms between rAF callbacks); returns the current budget. */
  record(frameMs: number): number {
    if (!(frameMs > 0) || frameMs > 1000) return this.value;
    this.sum += frameMs;
    this.n += 1;
    if (this.n < this.o.window) return this.value;
    const mean = this.sum / this.n;
    this.sum = 0;
    this.n = 0;
    if (mean > this.o.slowMs) {
      this.value = Math.max(this.min, Math.floor(this.value * this.o.down));
      this.calm = 0;
    } else if (mean < this.o.fastMs) {
      this.calm += 1;
      if (this.calm >= this.o.calmWindows && this.value < this.max) {
        this.value = Math.min(this.max, Math.ceil(this.value * this.o.up));
        this.calm = 0;
      }
    } else {
      this.calm = 0;
    }
    return this.value;
  }
}

/** Trail segments drawn per particle by zoom: fewer vertices at low zoom, where trails are tiny anyway. */
export function trailForZoom(zoom: number, max: number): number {
  const t = zoom < 4.5 ? 3 : zoom < 6.5 ? 4 : max;
  return Math.max(1, Math.min(max, t));
}

// ---------------------------------------------------------------------------
// Scrubber labels: a snapshot's anchor is its capture time, never "now".

export interface ScrubLabels {
  /** Panel title. */
  title: string;
  /** Selected step relative to the anchor, e.g. "now +6 h" or "snapshot run −3 h". */
  offset: string;
  /** Text of the jump-to-anchor button. */
  jump: string;
  /** Tick under the anchor on the slider. */
  tick: string;
  /** Prominent data-mode badge text. */
  mode: 'LIVE' | 'SNAPSHOT' | null;
  /** "14 Oct 07:19 UTC" (model run retrieval or snapshot capture), or null without data. */
  run: string | null;
}

const signed = (h: number) => (h < 0 ? `−${Math.abs(h)}` : `+${h}`);

function runLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
}

export function scrubLabels(data: { dataMode: 'live' | 'historical'; retrievedAt: string } | null, offsetH: number): ScrubLabels {
  const run = data ? runLabel(data.retrievedAt) : null;
  if (data?.dataMode === 'historical') {
    return {
      title: `Haze & wind model: snapshot run −24 h … +48 h`,
      offset: offsetH === 0 ? `snapshot run ${run}` : `snapshot run ${signed(offsetH)} h`,
      jump: 'Snapshot run',
      tick: 'run',
      mode: 'SNAPSHOT',
      run,
    };
  }
  return {
    title: `Haze & wind model: now −24 h … +48 h`,
    offset: offsetH === 0 ? 'now' : `now ${signed(offsetH)} h`,
    jump: 'Now',
    tick: 'now',
    mode: data ? 'LIVE' : null,
    run,
  };
}
