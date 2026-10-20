// Workspace sections and the URL hash they deep-link from (docs/UX_V3.md section 3). Pure, tested.
//   #ws=fires                      opens the Fires section
//   #ws=volcanoes&sel=watch-merapi opens Volcanoes with Merapi selected
//   #incident=watch-merapi         legacy link: selects Merapi (map mode)

export const SECTIONS = [
  // `hint`: one plain line for first-time visitors (shown beside the rail icon on hover and focus).
  { id: 'situation', label: 'Situation', title: 'Situation', hint: 'A short summary of what is happening now' },
  { id: 'haze', label: 'Haze', title: 'Haze & air', hint: 'Smoke levels by city, and where the smoke is heading' },
  { id: 'fires', label: 'Fires', title: 'Fires', hint: 'Fires seen by satellites, by country and province' },
  { id: 'volcanoes', label: 'Volcanoes', title: 'Volcanoes', hint: 'Watched volcanoes and their official alert levels' },
  { id: 'warnings', label: 'Warnings', title: 'Official warnings', hint: 'Every alert from national agencies, word for word' },
  { id: 'water', label: 'Water', title: 'Water & tsunami', hint: 'Tsunami messages, flood gauges, tides and river flow' },
  { id: 'report', label: 'Report', title: 'Report', hint: 'Make and download a written brief' },
  { id: 'sources', label: 'Sources', title: 'Sources & methods', hint: 'Where every number comes from, and its limits' },
  { id: 'layers', label: 'Layers', title: 'Layers', hint: 'Turn map layers on and off, with what each shows' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && SECTIONS.some((s) => s.id === value);
}

export function sectionById(id: SectionId): (typeof SECTIONS)[number] {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

export interface AppHash {
  /** Open workspace section; null means map mode. */
  ws: SectionId | null;
  /** Selected watch area id (a volcano or haze watch), or null. */
  sel: string | null;
}

/** Parse the location hash (with or without the leading "#"). Unknown values are ignored, never thrown. */
export function parseHash(hash: string): AppHash {
  const raw = (hash ?? '').replace(/^#/, '').trim();
  if (!raw) return { ws: null, sel: null };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ws: null, sel: null };
  }
  const ws = params.get('ws');
  const sel = params.get('sel') ?? params.get('incident');
  return { ws: isSectionId(ws) ? ws : null, sel: sel && sel.trim() ? sel.trim() : null };
}

/** The hash for a state: "" when there is nothing to encode (so the URL stays clean). */
export function buildHash(state: AppHash): string {
  const params = new URLSearchParams();
  if (state.ws) params.set('ws', state.ws);
  if (state.sel) params.set('sel', state.sel);
  const s = params.toString();
  return s ? `#${s}` : '';
}

// ---------------------------------------------------------------------------------------------
// The one thing selected on the map (its card is open). Watch areas keep their plain id in the hash
// (#sel=watch-merapi, and the legacy #incident=watch-merapi); every other kind is prefixed.

export type MapSelection =
  | { kind: 'area'; id: string }
  | { kind: 'city'; id: string }
  | { kind: 'fire'; id: string }
  | { kind: 'warning'; id: string };

const PREFIXED = ['city', 'fire', 'warning'] as const;

/** Hash `sel` value to a selection; null for nothing. Unknown prefixes are read as watch-area ids. */
export function selectionFromSel(sel: string | null): MapSelection | null {
  if (!sel) return null;
  const m = /^([a-z]+):(.+)$/.exec(sel);
  if (m && (PREFIXED as readonly string[]).includes(m[1])) {
    const id = m[2].trim();
    return id ? ({ kind: m[1], id } as MapSelection) : null;
  }
  return { kind: 'area', id: sel };
}

/** Selection to the hash `sel` value; null for nothing. */
export function selToHash(selection: MapSelection | null): string | null {
  if (!selection) return null;
  return selection.kind === 'area' ? selection.id : `${selection.kind}:${selection.id}`;
}

export function sameSelection(a: MapSelection | null, b: MapSelection | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
}
