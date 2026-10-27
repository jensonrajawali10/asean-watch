// Types for scripts/lib/firesBuild.mjs (the FIRMS snapshot builder shared by scripts/refresh-fires.mjs and
// src/lib/firesProxy.ts). Only what the TypeScript callers use; keep in step with that file's exports.
export interface FireBuildSource {
  id: string;
  sensor: string;
  latestDetection: string | null;
}

export interface FireBuildResult {
  /** The snapshot, serialised exactly as data/fires-snapshot.json is written. */
  text: string;
  plan: number;
  results: { sensor: string; latestMs: number; source: FireBuildSource }[];
  startedMs: number;
}

export declare function buildFireSnapshot(input: {
  region: unknown;
  adminLookup: unknown;
  previous?: unknown;
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  userAgent?: string;
  log?: (line: string) => void;
}): Promise<FireBuildResult>;

export declare function previousHistoryOf(prev: unknown): unknown[];
export declare function utf8Bytes(text: string): number;
