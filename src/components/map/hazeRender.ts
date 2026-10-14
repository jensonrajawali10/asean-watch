// Pure helpers for the haze controller (no DOM, no deck.gl): the smoke colour ramp, the PM2.5 raster
// (bilinear on the 1° grid, rows in Web Mercator so a BitmapLayer quad places it exactly) and a small
// particle system advected by a 925 hPa wind slice. MODELLED context only.
import { sampleRegular, sampleSlice } from '../../lib/windField';
import type { WindSlice } from '../../lib/windField';

export type Rgba = [number, number, number, number];

/** Ramp stops: PM2.5 µg/m³ → colour and alpha (0..1). Transparent below the first stop. */
interface Stop {
  v: number;
  c: [number, number, number];
  a: number;
}
const SMOKE_LIGHT: readonly Stop[] = [
  { v: 12, c: [214, 190, 150], a: 0 },
  { v: 25, c: [208, 180, 134], a: 0.22 },
  { v: 55, c: [190, 148, 96], a: 0.38 },
  { v: 150, c: [150, 100, 58], a: 0.52 },
  { v: 400, c: [104, 66, 36], a: 0.62 },
];
/** Dark basemap (CARTO Dark Matter): a warm tan smoke around #c9a675, never above 0.55 opacity. */
const SMOKE_DARK: readonly Stop[] = [
  { v: 12, c: [201, 166, 117], a: 0 },
  { v: 25, c: [201, 166, 117], a: 0.14 },
  { v: 55, c: [201, 166, 117], a: 0.27 },
  { v: 150, c: [196, 156, 104], a: 0.42 },
  { v: 400, c: [188, 142, 92], a: 0.55 },
];

/** Smoke colour for a PM2.5 value: transparent when clean, warm tan to brown (light map) or tan smoke (dark map). */
export function smokeRgba(v: number, dark: boolean): Rgba {
  const stops = dark ? SMOKE_DARK : SMOKE_LIGHT;
  if (!(v > stops[0].v)) return [stops[0].c[0], stops[0].c[1], stops[0].c[2], 0];
  const last = stops[stops.length - 1];
  if (v >= last.v) return [last.c[0], last.c[1], last.c[2], Math.round(last.a * 255)];
  let k = 1;
  while (v > stops[k].v) k += 1;
  const s0 = stops[k - 1];
  const s1 = stops[k];
  const t = (Math.log(v) - Math.log(s0.v)) / (Math.log(s1.v) - Math.log(s0.v));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return [mix(s0.c[0], s1.c[0]), mix(s0.c[1], s1.c[1]), mix(s0.c[2], s1.c[2]), Math.round((s0.a + (s1.a - s0.a) * t) * 255)];
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
  dark: boolean,
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
      const [cr, cg, cb, ca] = smokeRgba(v, dark);
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
   * Trail segments into fixed slots (particle p, segment k → slot p·trail + k) for a deck.gl LineLayer
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
  ): number {
    const slots = this.trail + 1;
    let visible = 0;
    for (let p = 0; p < this.count; p += 1) {
      const base = p * slots * 2;
      const lifeFade = Math.min(1, this.age[p] / 8, (this.maxAge[p] - this.age[p]) / 12);
      const speedA = Math.min(1, 0.35 + this.speed[p] / 12);
      for (let k = 0; k < this.trail; k += 1) {
        const n = p * this.trail + k;
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
        out.color[n * 4 + 3] = show ? Math.round(255 * maxAlpha * lifeFade * speedA * (1 - k / this.trail)) : 0;
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
