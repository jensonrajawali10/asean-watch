// Shared by the browser loader (src/lib/vaac.ts) and the server relay (src/lib/vaacProxy.ts, api/vaac.ts):
// the relay path, its answer and the fixed visitor-facing reasons. No logic beyond types, so the browser
// bundle carries none of the server code.
//
// Why a relay: one Tokyo VAAC advisory needs two downloads (the 170 KB list page, then its text page), and
// every open tab would repeat them every few minutes. The relay builds the set once (scripts/lib/vaacBuild.mjs)
// and keeps it at the CDN for ten minutes, the same time JMA's own pages are cached for (max-age=600). A
// failed build reaches the browser as a 200 { available: false } beside the bundled HISTORICAL snapshot.
import type { BuildFailureReason } from './buildRelay';
import type { VaacBuildData } from '../../scripts/lib/vaacBuild.mjs';

export type { VaacBuildAdvisory, VaacBuildData } from '../../scripts/lib/vaacBuild.mjs';

export const VAAC_RELAY_PATH = '/api/vaac';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const VAAC_REASON_TEXT: Record<BuildFailureReason, string> = {
  timeout: 'The Tokyo VAAC site did not answer in time',
  upstream_http: 'The Tokyo VAAC site returned an error',
  bad_answer: 'The Tokyo VAAC site did not return the expected advisory list',
  network: 'The Tokyo VAAC site could not be reached',
};

export type VaacPayload =
  | {
      available: true;
      /** True while the source is failing and the relay serves its last good build. */
      stale: boolean;
      data: VaacBuildData;
    }
  | { available: false; checkedAt: string; reason: BuildFailureReason; message: string };
