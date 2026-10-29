// Shared by the browser loader (src/lib/watchLive.ts) and the server relay (src/lib/watchProxy.ts,
// api/watch.ts): the relay path, its answer and the fixed visitor-facing reasons. No logic beyond types,
// so the browser bundle carries none of the server code.
//
// Why a relay: the watch-area evidence (FIRMS hotspots near the volcanoes and in the haze boxes, and the
// USGS and BMKG earthquakes near the volcanoes) is built from four FIRMS CSVs of about 8 MB each, which
// send no CORS headers, plus the USGS and BMKG feeds. The relay runs the same builder as
// scripts/refresh-data.mjs every few hours, so the Overview and Volcanoes evidence stays current between
// deploys. A failed build reaches the browser as a 200 { available: false } beside the bundled
// HISTORICAL snapshot, never as a console error.
import type { BuildFailureReason } from './buildRelay';

export const WATCH_RELAY_PATH = '/api/watch';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const WATCH_REASON_TEXT: Record<BuildFailureReason, string> = {
  timeout: 'NASA FIRMS, USGS or BMKG did not answer in time',
  upstream_http: 'NASA FIRMS, USGS or BMKG returned an error',
  bad_answer: 'NASA FIRMS, USGS or BMKG did not return the expected data',
  network: 'NASA FIRMS, USGS or BMKG could not be reached',
};

/** The build: the three data/real files, parsed, and the new scenario window. */
export interface WatchData {
  firms: unknown;
  quakes: unknown;
  meta: unknown;
  scenarioWindow: { start: string; end: string };
}

export type WatchPayload =
  | {
      available: true;
      /** True while a source is failing and the relay serves its last good build. */
      stale: boolean;
      data: WatchData;
    }
  | { available: false; checkedAt: string; reason: BuildFailureReason; message: string };
