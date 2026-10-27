// Shared by the browser loader (src/lib/firesLive.ts) and the server relay (src/lib/firesProxy.ts,
// api/fires.ts): the relay path, its answer and the fixed visitor-facing reasons. No logic beyond types,
// so the browser bundle carries none of the server code.
//
// Why a relay: FIRMS sends no CORS headers, and the fire view is built from four 7-day CSVs of about
// 8 MB each. The relay downloads them, builds the same snapshot scripts/refresh-fires.mjs writes, and
// keeps it at the Vercel CDN for a few hours, so the fires on the map stay current between deploys
// without anyone committing data. A failed build reaches the browser as a 200 { available: false }
// beside the bundled HISTORICAL snapshot, never as a console error.

export const FIRES_RELAY_PATH = '/api/fires';

export type FiresUnavailableReason = 'timeout' | 'upstream_http' | 'bad_answer' | 'network';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const FIRES_REASON_TEXT: Record<FiresUnavailableReason, string> = {
  timeout: 'NASA FIRMS did not answer in time',
  upstream_http: 'NASA FIRMS returned an error',
  bad_answer: 'NASA FIRMS did not return the expected files',
  network: 'NASA FIRMS could not be reached',
};

export type FiresPayload =
  | {
      available: true;
      /** True while FIRMS is failing and the relay serves its last good build. */
      stale: boolean;
      /** The snapshot, in the data/fires-snapshot.json format (its own retrievedAt is when FIRMS was read). */
      snapshot: unknown;
    }
  | { available: false; checkedAt: string; reason: FiresUnavailableReason; message: string };
