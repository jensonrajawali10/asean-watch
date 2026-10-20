// City circles for map mode (docs/UX_V3.md section 2, after HazeView): big circles sized and coloured by
// MODELLED PM2.5, each labelled with its value, labels placed without overlaps, and a gentle pulse on the
// worst city. Pure helpers for HazeLayerController; tested.

/** Below this zoom the map is at its regional view: city labels are planned and overlapping fire-area circles hidden. */
export const CITY_LABEL_ZOOM = 6;

/** Circle radius in pixels for a PM2.5 value: grows with the square root, 6 to 26 px (HazeView's scale). */
export function cityRadiusPx(pm25: number): number {
  if (!Number.isFinite(pm25) || pm25 <= 0) return 6;
  return Math.max(6, Math.min(26, 5 + Math.sqrt(pm25) * 1.45));
}

/** The id of the highest finite value, or null. Ties keep the first. */
export function worstId<T extends { id: string; pm25: number }>(items: readonly T[]): string | null {
  let best: T | null = null;
  for (const it of items) if (Number.isFinite(it.pm25) && (!best || it.pm25 > best.pm25)) best = it;
  return best ? best.id : null;
}

/** "Palangka Raya (Central Kalimantan)" → "Palangka Raya". */
export function shortCityName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}

/** "719", "1,204": the value as a label. */
export function valueText(pm25: number): string {
  return Number.isFinite(pm25) ? Math.round(pm25).toLocaleString('en-US') : '—';
}

/** "Palangka Raya  407 µg/m³": a city's full map label, with the unit (the value-only label stays a bare number). */
export function fullCityLabel(name: string, value: string): string {
  return `${name}  ${value} µg/m³`;
}

export interface LabelCandidate {
  id: string;
  /** Screen position of the circle centre (px). */
  x: number;
  y: number;
  /** Circle radius (px). */
  r: number;
  name: string;
  value: string;
  /** Higher places first (the PM2.5 value). */
  priority: number;
  /** Always labelled in full (selected or hovered). */
  force?: boolean;
}

export interface PlacedLabel {
  id: string;
  text: string;
  /** 'full' = name and value; 'value' = the value only (the name did not fit). */
  kind: 'full' | 'value';
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Greedy label placement, worst first: a label sits right of its circle ("Name 719"); when that overlaps a
 * label already placed or another circle, the value alone is tried; else the circle stays unlabelled.
 * `charPx` is the average glyph width at the label size. Deterministic.
 */
export function placeCityLabels(cands: readonly LabelCandidate[], opts: { charPx?: number; heightPx?: number; gapPx?: number; viewport?: { w: number; h: number } } = {}): PlacedLabel[] {
  const charPx = opts.charPx ?? 7;
  const h = opts.heightPx ?? 16;
  const gap = opts.gapPx ?? 5;
  const circles: (Box & { id: string })[] = cands.map((c) => ({ id: c.id, x0: c.x - c.r, y0: c.y - c.r, x1: c.x + c.r, y1: c.y + c.r }));
  const placed: Box[] = [];
  const out: PlacedLabel[] = [];
  const order = [...cands].sort((a, b) => Number(Boolean(b.force)) - Number(Boolean(a.force)) || b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const inView = (b: Box) => !opts.viewport || (b.x0 >= 0 && b.y0 >= 0 && b.x1 <= opts.viewport.w && b.y1 <= opts.viewport.h);
  const free = (b: Box, id: string) => inView(b) && !placed.some((p) => hits(p, b)) && !circles.some((c) => c.id !== id && hits(c, b));
  for (const c of order) {
    const box = (text: string): Box => {
      const w = text.length * charPx;
      const x0 = c.x + c.r + gap;
      return { x0, y0: c.y - h / 2, x1: x0 + w, y1: c.y + h / 2 };
    };
    const full = fullCityLabel(c.name, c.value);
    const fb = box(full);
    if (c.force || free(fb, c.id)) {
      placed.push(fb);
      out.push({ id: c.id, text: full, kind: 'full' });
      continue;
    }
    const vb = box(c.value);
    if (free(vb, c.id)) {
      placed.push(vb);
      out.push({ id: c.id, text: c.value, kind: 'value' });
    }
  }
  return out;
}

/** Circles shrink a little at the regional zoom, so dense clusters (Sumatra, Java, Kalimantan) stay readable. */
export function cityZoomScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return zoom < 4.5 ? 0.7 : zoom < 6 ? 0.85 : 1;
}

/** The drawn circle radius: by value, zoom, kind and focus (selected or hovered). */
export function cityMarkerRadius(pm25: number, zoom: number, kind: 'city' | 'fire-area' = 'city', focused = false): number {
  return cityRadiusPx(pm25) * cityZoomScale(zoom) * (kind === 'fire-area' ? 0.85 : 1) + (focused ? 2 : 0);
}

/** Pulse ring around the worst city at time t (ms): grows from the circle out by `spreadPx` and fades. */
export function pulseRing(radiusPx: number, tMs: number, periodMs = 2400, spreadPx = 24): { radius: number; alpha: number } {
  const phase = (((tMs % periodMs) + periodMs) % periodMs) / periodMs;
  return { radius: radiusPx + 3 + phase * spreadPx, alpha: Math.round((1 - phase) * 180) };
}

/**
 * Circles in draw order for the map, cities last (on top, so a click on a city's circle opens that city),
 * without the fire-area circles that overlap a city circle on screen at the regional zoom: there the
 * fire-area town (e.g. Pulang Pisau) sat on top of its province's city (Palangka Raya) and took its clicks.
 * Zoomed in (`regional` false) every circle is kept. `screen` gives each circle's centre and radius in px.
 */
export function cityDrawOrder<T extends { id: string; kind: 'city' | 'fire-area' }>(
  items: readonly T[],
  screen: (d: T) => { x: number; y: number; r: number },
  regional: boolean,
): T[] {
  const cities = items.filter((d) => d.kind === 'city');
  const fireAreas = items.filter((d) => d.kind === 'fire-area');
  const cityPts = cities.map(screen);
  const keep = regional
    ? fireAreas.filter((f) => {
        const p = screen(f);
        return cityPts.every((c) => Math.hypot(c.x - p.x, c.y - p.y) > c.r + p.r);
      })
    : fireAreas;
  return [...keep, ...cities];
}
