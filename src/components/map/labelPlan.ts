// One collision plan for the labels of map mode (docs/UX_V3.md section 2), so the Sumatra-Java-Kalimantan
// area reads instead of piling up. Priority, highest first:
//   1. official warning pins and 2. volcano names (fixed: passed in as obstacles);
//   3. the worst few city labels;
//   4. fire region badges (the top few at the default zoom), nudged to another side or hidden on collision;
//   5. the other city labels (name and value, else the value alone, else nothing).
// Every city circle is an obstacle for every label but its own. Pure and deterministic; tested.

/** Below this zoom fire badges are regions, in this plan (MapView); from it, the fires module's cluster badges. */
export const REGIONAL_ZOOM = 5.2;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlanCity {
  id: string;
  /** Screen centre and radius of the circle (px). */
  x: number;
  y: number;
  r: number;
  name: string;
  value: string;
  pm25: number;
  /** Selected or hovered: always labelled in full. */
  force?: boolean;
}

export interface PlanBadge {
  id: string;
  /** Screen anchor (px). */
  x: number;
  y: number;
  text: string;
  /** Larger first (hotspot count). */
  priority: number;
}

export type BadgeSide = 'above' | 'below' | 'right' | 'left';

export interface LabelPlan {
  /** City id to label text ("Name  719" or "719"); cities not listed get no label. */
  cities: Map<string, string>;
  /** Placed badges: the side, how far out (0 = next to the point, 1 = nudged further), and the box. */
  badges: { id: string; side: BadgeSide; far: boolean; box: Box; dx: number; dy: number }[];
}

export interface PlanOptions {
  /** Boxes already taken: official pins, volcano symbols and their name tags. */
  obstacles?: readonly Box[];
  /** How many of the worst cities are placed before the badges. */
  topCities?: number;
  /** Most fire badges shown. */
  maxBadges?: number;
  viewport?: { w: number; h: number };
  /** Average glyph width of city labels and badges, and their heights (px). */
  charPx?: number;
  labelH?: number;
  badgeCharPx?: number;
  badgeH?: number;
}

const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const pmOrder = (v: number) => (Number.isFinite(v) ? v : -1);

export function planRegionalLabels(cities: readonly PlanCity[], badges: readonly PlanBadge[], opts: PlanOptions = {}): LabelPlan {
  const charPx = opts.charPx ?? 7.2;
  const labelH = opts.labelH ?? 16;
  const badgeCharPx = opts.badgeCharPx ?? 6.6;
  const badgeH = opts.badgeH ?? 20;
  const topN = opts.topCities ?? 5;
  const maxBadges = opts.maxBadges ?? 3;
  const vp = opts.viewport;
  const taken: Box[] = [...(opts.obstacles ?? [])];
  const circles = cities.map((c) => ({ id: c.id, box: { x0: c.x - c.r, y0: c.y - c.r, x1: c.x + c.r, y1: c.y + c.r } }));
  const inView = (b: Box) => !vp || (b.x0 >= 0 && b.y0 >= 0 && b.x1 <= vp.w && b.y1 <= vp.h);
  const free = (b: Box, ownId: string | null) => inView(b) && !taken.some((t) => hits(t, b)) && !circles.some((c) => c.id !== ownId && hits(c.box, b));

  const out: LabelPlan = { cities: new Map(), badges: [] };
  const order = [...cities].sort((a, b) => Number(Boolean(b.force)) - Number(Boolean(a.force)) || pmOrder(b.pm25) - pmOrder(a.pm25) || (a.id < b.id ? -1 : 1));
  const placeCity = (c: PlanCity) => {
    const at = (text: string): Box => {
      const x0 = c.x + c.r + 6;
      return { x0, y0: c.y - labelH / 2, x1: x0 + text.length * charPx, y1: c.y + labelH / 2 };
    };
    const full = `${c.name}  ${c.value}`;
    const fb = at(full);
    if (c.force || free(fb, c.id)) {
      taken.push(fb);
      out.cities.set(c.id, full);
      return;
    }
    const vb = at(c.value);
    if (free(vb, c.id)) {
      taken.push(vb);
      out.cities.set(c.id, c.value);
    }
  };

  const top = order.filter((c, i) => c.force || i < topN);
  const topIds = new Set(top.map((c) => c.id));
  top.forEach(placeCity);

  const sides: BadgeSide[] = ['above', 'below', 'right', 'left'];
  const sortedBadges = [...badges].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const b of sortedBadges) {
    if (out.badges.length >= maxBadges) break;
    const w = b.text.length * badgeCharPx + 18;
    // Next to the point first; then nudged further out (the badge still names its place).
    const boxFor = (side: BadgeSide, far: boolean): Box => {
      const g = far ? 40 : 8;
      switch (side) {
        case 'above':
          return { x0: b.x - w / 2, y0: b.y - badgeH - g, x1: b.x + w / 2, y1: b.y - g };
        case 'below':
          return { x0: b.x - w / 2, y0: b.y + g, x1: b.x + w / 2, y1: b.y + g + badgeH };
        case 'right':
          return { x0: b.x + g + 2, y0: b.y - badgeH / 2, x1: b.x + g + 2 + w, y1: b.y + badgeH / 2 };
        case 'left':
          return { x0: b.x - g - 2 - w, y0: b.y - badgeH / 2, x1: b.x - g - 2, y1: b.y + badgeH / 2 };
      }
    };
    placing: for (const far of [false, true]) {
      for (const side of sides) {
        const box = boxFor(side, far);
        if (free(box, null)) {
          taken.push(box);
          out.badges.push({ id: b.id, side, far, box, dx: box.x0 - b.x, dy: box.y0 - b.y });
          break placing;
        }
      }
    }
  }

  order.filter((c) => !topIds.has(c.id)).forEach(placeCity);
  return out;
}
