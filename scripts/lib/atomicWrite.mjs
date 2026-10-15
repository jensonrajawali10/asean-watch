// Atomic file writes for the snapshot scripts. Plain Node, no dependencies.
//
// writeFileAtomic(target, content)
//   Writes a temp file beside the target, then renames it over the target. A reader (or a crash)
//   sees either the old file or the complete new one, never a half-written file.
//
// writeAllOrNothing([[target, content], ...])
//   The same for several files that must change together (refresh-data: firms, quakes, meta and
//   watches). Every temp file is written first, then every existing target is copied to a backup,
//   then the temps are renamed over the targets one by one. If any rename fails (on Windows EPERM or
//   EBUSY is common when an editor, antivirus or the dev server holds a file open), the targets
//   already replaced are put back from their backups, or removed if they did not exist before.
//   The thrown AtomicWriteError says what state the files are in:
//     state 'unchanged'       nothing was replaced (a temp or backup could not be written);
//     state 'restored'        some targets were replaced, and all of them were put back;
//     state 'restore-failed'  some could not be put back; err.kept lists { backup, target } pairs
//                             left for a manual restore (rename each backup over its target).
//
// Temp and backup names carry a per-run tag, so a run never overwrites a backup an earlier failed
// run left behind. `fs` can be injected (tests simulate a failing rename).
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class AtomicWriteError extends Error {
  /**
   * @param {string} message
   * @param {{ state: 'unchanged' | 'restored' | 'restore-failed', cause?: unknown, kept?: Array<{ backup: string, target: string }> }} details
   */
  constructor(message, { state, cause, kept = [] }) {
    super(message, { cause });
    this.name = 'AtomicWriteError';
    this.state = state;
    this.kept = kept;
  }
}

function toPath(target) {
  return target instanceof URL ? fileURLToPath(target) : String(target);
}

function runTag() {
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describe(err) {
  return err instanceof Error ? err.message : String(err);
}

async function existsFile(fs, p) {
  try {
    await fs.stat(p);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

/** Removes files, ignoring errors; returns the ones that could not be removed. */
async function removeAll(fs, paths) {
  const left = [];
  for (const p of paths) {
    try {
      await fs.rm(p, { force: true });
    } catch {
      left.push(p);
    }
  }
  return left;
}

/**
 * Writes one file atomically (temp file + rename). Throws AtomicWriteError (state 'unchanged') on
 * failure, after removing the temp file; the previous target is then untouched.
 * @param {string | URL} target
 * @param {string | Uint8Array} content
 * @param {{ fs?: typeof nodeFs }} [options]
 */
export async function writeFileAtomic(target, content, { fs = nodeFs } = {}) {
  const file = toPath(target);
  const tmp = `${file}.${runTag()}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    await removeAll(fs, [tmp]);
    throw new AtomicWriteError(`could not write ${path.basename(file)} (${describe(err)}); the previous file is unchanged`, {
      state: 'unchanged',
      cause: err,
    });
  }
}

/**
 * Replaces several files together: all of them, or (after a restore) none of them.
 * Returns { written, leftover }: the targets written, and any backup that could not be removed
 * afterwards (harmless, reported so the caller can mention it).
 * @param {Array<[string | URL, string | Uint8Array]>} files
 * @param {{ fs?: typeof nodeFs }} [options]
 * @returns {Promise<{ written: string[], leftover: string[] }>}
 */
export async function writeAllOrNothing(files, { fs = nodeFs } = {}) {
  const tag = runTag();
  const plan = files.map(([target, content]) => {
    const file = toPath(target);
    return { file, content, tmp: `${file}.${tag}.tmp`, bak: `${file}.${tag}.bak`, hadOriginal: false, replaced: false };
  });
  const names = (list) => list.map((p) => path.basename(p.file)).join(', ');

  // 1. Every temp file, then a backup copy of every existing target. Nothing is replaced yet.
  try {
    for (const p of plan) await fs.writeFile(p.tmp, p.content, 'utf8');
    for (const p of plan) {
      p.hadOriginal = await existsFile(fs, p.file);
      if (p.hadOriginal) await fs.copyFile(p.file, p.bak);
    }
  } catch (err) {
    await removeAll(fs, plan.flatMap((p) => [p.tmp, p.bak]));
    throw new AtomicWriteError(`could not prepare the new files (${describe(err)}); nothing was replaced`, { state: 'unchanged', cause: err });
  }

  // 2. Rename the temps over the targets.
  let failed = null;
  let failure = null;
  for (const p of plan) {
    try {
      await fs.rename(p.tmp, p.file);
      p.replaced = true;
    } catch (err) {
      failed = p;
      failure = err;
      break;
    }
  }
  if (failed === null) {
    const leftover = await removeAll(fs, plan.filter((p) => p.hadOriginal).map((p) => p.bak));
    return { written: plan.map((p) => p.file), leftover };
  }

  // 3. A rename failed: put back what was replaced, newest first.
  const replaced = plan.filter((p) => p.replaced);
  const notRestored = [];
  for (const p of [...replaced].reverse()) {
    try {
      if (p.hadOriginal) await fs.rename(p.bak, p.file);
      else await fs.rm(p.file, { force: true });
    } catch (err) {
      notRestored.push({ p, err });
    }
  }
  const stillBackedUp = new Set(notRestored.map(({ p }) => p));
  await removeAll(fs, [
    ...plan.filter((p) => !p.replaced).map((p) => p.tmp),
    ...plan.filter((p) => p.hadOriginal && !p.replaced).map((p) => p.bak),
  ]);
  const cause = `writing ${path.basename(failed.file)} failed (${describe(failure)})`;
  if (notRestored.length === 0) {
    if (replaced.length === 0) {
      throw new AtomicWriteError(`${cause}; no file had been replaced yet, so every file is unchanged`, { state: 'unchanged', cause: failure });
    }
    throw new AtomicWriteError(`${cause}; the files already replaced (${names(replaced)}) were put back, so every file is unchanged`, {
      state: 'restored',
      cause: failure,
    });
  }
  const kept = [...stillBackedUp].filter((p) => p.hadOriginal).map((p) => ({ backup: p.bak, target: p.file }));
  const details = notRestored.map(({ p, err }) => `${path.basename(p.file)} (${describe(err)})`).join('; ');
  throw new AtomicWriteError(`${cause}, and restoring failed for ${details}. The files are now a mix of old and new.`, {
    state: 'restore-failed',
    cause: failure,
    kept,
  });
}
