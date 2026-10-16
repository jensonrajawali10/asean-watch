// Types for scripts/lib/atomicWrite.mjs (used by the tests in src/scripts/). Keep in step with it.
import type * as nodeFs from 'node:fs/promises';

export type AtomicWriteState = 'unchanged' | 'restored' | 'restore-failed';

export declare class AtomicWriteError extends Error {
  constructor(message: string, details: { state: AtomicWriteState; cause?: unknown; kept?: Array<{ backup: string; target: string }> });
  readonly state: AtomicWriteState;
  /** Backups left for a manual restore (state 'restore-failed' only). */
  readonly kept: Array<{ backup: string; target: string }>;
}

/** The fs functions the helpers use; tests pass a partial stand-in to simulate failures. */
export type AtomicFs = Pick<typeof nodeFs, 'writeFile' | 'rename' | 'rm' | 'copyFile' | 'stat'> | Record<string, unknown>;

export declare function writeFileAtomic(target: string | URL, content: string | Uint8Array, options?: { fs?: AtomicFs }): Promise<void>;

export declare function writeAllOrNothing(
  files: Array<[string | URL, string | Uint8Array]>,
  options?: { fs?: AtomicFs },
): Promise<{ written: string[]; leftover: string[] }>;
