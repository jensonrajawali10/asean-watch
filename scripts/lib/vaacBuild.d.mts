// Types for scripts/lib/vaacBuild.mjs (the Tokyo VAAC advisory builder shared by
// scripts/capture-vaac-snapshot.mjs and src/lib/vaacProxy.ts). Keep in step with that file's exports.
export interface VaacListRow {
  /** ISO 8601 UTC, from the list's hidden sort cell. */
  listedAt: string;
  volcano: string;
  area: string;
  number: string;
  /** Relative text page path, e.g. "TextData/2026/20261029_28208001_0332_Text.html". */
  path: string;
}

export interface VaacBuildAdvisory {
  url: string;
  listedAt: string;
  volcano: string;
  area: string;
  number: string;
  /** The advisory text, word for word, lines separated by "\n". */
  text: string;
}

export interface VaacBuildData {
  source: string;
  licence: string;
  listUrl: string;
  retrievedAt: string;
  windowHours: number;
  listRows: number;
  listUpdated: string | null;
  advisories: VaacBuildAdvisory[];
}

export declare const VAAC_TOKYO_LIST_URL: string;
export declare const VAAC_TOKYO_SOURCE: string;
export declare const VAAC_TOKYO_LICENCE: string;
export declare const VAAC_WINDOW_HOURS: number;
export declare const VAAC_MAX_ADVISORIES: number;
export declare function parseVaacList(html: string): VaacListRow[];
export declare function selectRecent(rows: readonly VaacListRow[], opts: { now: number; windowHours?: number; max?: number }): VaacListRow[];
export declare function extractVaaText(html: string): string;
export declare function vaacOf(text: string): string | null;
export declare function buildVaacData(input?: {
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  userAgent?: string;
  log?: (line: string) => void;
}): Promise<VaacBuildData>;
