// Parser for MAGMA Indonesia's public volcano activity level list
// (https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas). Owned by the logic builder.
//
// Standalone on purpose (no imports): scripts/capture-warnings-snapshot.mjs imports this file
// directly with Node's TypeScript type stripping, and warnings.ts uses it too, so both share one parser.
//
// Only facts are extracted: the level heading (e.g. "Level III (Siaga)") and each volcano's name label
// ("Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah"). The level descriptions and the per-volcano
// reports are not copied. The parser throws a readable Error when the page structure is not recognised,
// so the capture script can keep the previous records instead of writing bad or empty data.

export interface MagmaVolcanoLevel {
  /** Verbatim volcano name, e.g. "Merapi". */
  name: string;
  /** Verbatim region label after " - ", e.g. "Jawa Timur"; null when absent. */
  region: string | null;
  /** Verbatim level heading, e.g. "Level III (Siaga)". */
  level: string;
  /** 1-4 from the Roman numeral in the heading. */
  levelNumber: number;
}

export interface MagmaLevelList {
  headings: Array<{ level: string; levelNumber: number; count: number | null }>;
  volcanoes: MagmaVolcanoLevel[];
}

/** Volcanoes always recorded whatever their level (the ASEAN Watch watch areas). */
export const MAGMA_WATCHED = ['Merapi', 'Semeru', 'Anak Krakatau', 'Sinabung'] as const;

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

function clean(text: string): string {
  const decoded = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (whole, e: string) => ENTITIES[e] ?? whole);
  return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Parse the level table. Throws when no level heading is found, when no volcano entry is found, or
 * when the number of Level III/IV entries differs from the count MAGMA prints next to the heading.
 */
export function parseMagmaLevelList(html: string): MagmaLevelList {
  if (typeof html !== 'string' || html.length === 0) throw new Error('MAGMA page is empty');
  const token =
    /<a\b[^>]*>\s*(Level (IV|III|II|I) \([^()<>]{1,40}\))\s*<\/a>|<td\b[^>]*class="[^"]*tx-12[^"]*"[^>]*>\s*(\d+)\s*<\/td>|<td\b[^>]*>\s*([^<>]{2,160}?)\s*<a\s[^>]*href="[^"]*\/gunung-api\/laporan\/[^"]*"/g;
  const headings: MagmaLevelList['headings'] = [];
  const volcanoes: MagmaVolcanoLevel[] = [];
  const perHeading = new Map<string, number>();
  let current: MagmaLevelList['headings'][number] | null = null;
  for (const m of html.matchAll(token)) {
    if (m[1] && m[2]) {
      current = { level: clean(m[1]), levelNumber: ROMAN[m[2]], count: null };
      headings.push(current);
      perHeading.set(current.level, 0);
    } else if (m[3] !== undefined) {
      if (current && current.count === null) current.count = Number(m[3]);
    } else if (m[4] !== undefined && current) {
      const label = clean(m[4]);
      const split = label.indexOf(' - ');
      volcanoes.push({
        name: split >= 0 ? label.slice(0, split).trim() : label,
        region: split >= 0 ? label.slice(split + 3).trim() || null : null,
        level: current.level,
        levelNumber: current.levelNumber,
      });
      perHeading.set(current.level, (perHeading.get(current.level) ?? 0) + 1);
    }
  }
  if (headings.length === 0) throw new Error('MAGMA page structure changed: no level headings found');
  if (volcanoes.length === 0) throw new Error('MAGMA page structure changed: no volcano entries found');
  for (const h of headings) {
    const found = perHeading.get(h.level) ?? 0;
    if (h.levelNumber >= 3 && h.count !== null && h.count !== found) {
      throw new Error(`MAGMA page structure changed: ${h.level} lists ${found} volcanoes but the page says ${h.count}`);
    }
  }
  return { headings, volcanoes };
}

/** Level III and IV volcanoes, plus every watched volcano at whatever level it is. */
export function selectMagmaVolcanoes(
  list: MagmaLevelList,
  watched: readonly string[] = MAGMA_WATCHED,
): MagmaVolcanoLevel[] {
  const want = new Set(watched.map((w) => w.toLowerCase()));
  return list.volcanoes.filter((v) => v.levelNumber >= 3 || want.has(v.name.toLowerCase()));
}
