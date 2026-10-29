// Types for scripts/lib/watchDataBuild.mjs (the watch-area snapshot builder shared by
// scripts/refresh-data.mjs and src/lib/watchProxy.ts). Only what the TypeScript callers use; keep in step
// with that file's exports.
export interface WatchBuildResult {
  files: { firms: string; quakes: string; meta: string };
  firms: { about: string; rows: unknown[]; hazeDayTotals: unknown[] };
  quakes: { about: string; rows: unknown[] };
  meta: { retrievedAt: string; window: { start: string; end: string; days: number }; sources: unknown[] } & Record<string, unknown>;
  scenarioWindow: { start: string; end: string };
  updatedWatches: unknown[];
  snapshotBytes: number;
  startedMs: number;
}

export declare function buildWatchData(input: {
  watches: unknown;
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  userAgent?: string;
  log?: (line: string) => void;
}): Promise<WatchBuildResult>;

export declare const FIRMS_ABOUT: string;
export declare const QUAKES_ABOUT: string;
export declare function utf8Bytes(text: string): number;
