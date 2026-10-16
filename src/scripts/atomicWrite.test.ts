// Tests for scripts/lib/atomicWrite.mjs (the snapshot scripts' file writes). They live under src/
// because vitest collects src/**/*.test.ts. Each test works in its own temp directory.
import * as nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AtomicWriteError, writeAllOrNothing, writeFileAtomic } from '../../scripts/lib/atomicWrite.mjs';

let dir = '';
beforeEach(async () => {
  dir = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'asean-watch-atomic-'));
});
afterEach(async () => {
  await nodeFs.rm(dir, { recursive: true, force: true });
});

const at = (name: string) => path.join(dir, name);
const read = (name: string) => nodeFs.readFile(at(name), 'utf8');
const listing = async () => (await nodeFs.readdir(dir)).sort();

function eperm(from: string, to: string): Error {
  return Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' });
}

/** node:fs/promises with rename (and optionally writeFile) failing for chosen paths. */
function failingFs(opts: { renameTo?: (to: string, from: string) => boolean; writeTo?: (p: string) => boolean }) {
  return {
    ...nodeFs,
    rename: async (from: string, to: string) => {
      if (opts.renameTo?.(String(to), String(from))) throw eperm(String(from), String(to));
      return nodeFs.rename(from, to);
    },
    writeFile: async (p: string, data: string, enc: BufferEncoding) => {
      if (opts.writeTo?.(String(p))) throw Object.assign(new Error(`ENOSPC: no space left on device, open '${p}'`), { code: 'ENOSPC' });
      return nodeFs.writeFile(p, data, enc);
    },
  };
}

async function seedOld() {
  await nodeFs.writeFile(at('firms.json'), 'OLD firms', 'utf8');
  await nodeFs.writeFile(at('quakes.json'), 'OLD quakes', 'utf8');
  await nodeFs.writeFile(at('meta.json'), 'OLD meta', 'utf8');
  await nodeFs.writeFile(at('watches.json'), 'OLD watches', 'utf8');
}

const NEW_FILES = (): Array<[string, string]> => [
  [at('firms.json'), 'NEW firms'],
  [at('quakes.json'), 'NEW quakes'],
  [at('meta.json'), 'NEW meta'],
  [at('watches.json'), 'NEW watches'],
];

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temp file; accepts a file URL', async () => {
    await nodeFs.writeFile(at('nea.json'), 'OLD', 'utf8');
    await writeFileAtomic(at('nea.json'), 'NEW');
    expect(await read('nea.json')).toBe('NEW');
    await writeFileAtomic(pathToFileURL(at('ptwc.json')), 'FIRST');
    expect(await read('ptwc.json')).toBe('FIRST');
    expect(await listing()).toEqual(['nea.json', 'ptwc.json']);
  });

  it('keeps the previous file and removes the temp when the rename fails', async () => {
    await nodeFs.writeFile(at('nea.json'), 'OLD', 'utf8');
    const fs = failingFs({ renameTo: (to) => to.endsWith('nea.json') });
    const err = await writeFileAtomic(at('nea.json'), 'NEW', { fs }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtomicWriteError);
    expect(err).toMatchObject({ state: 'unchanged' });
    expect((err as Error).message).toMatch(/^could not write nea\.json \(EPERM: .*\); the previous file is unchanged$/);
    expect(await read('nea.json')).toBe('OLD');
    expect(await listing()).toEqual(['nea.json']);
  });
});

describe('writeAllOrNothing', () => {
  it('replaces every file, creates new ones, and leaves no temp or backup', async () => {
    await seedOld();
    await nodeFs.rm(at('quakes.json'));
    const { written, leftover } = await writeAllOrNothing(NEW_FILES());
    expect(written).toEqual(NEW_FILES().map(([f]) => f));
    expect(leftover).toEqual([]);
    for (const name of ['firms', 'quakes', 'meta', 'watches']) expect(await read(`${name}.json`)).toBe(`NEW ${name}`);
    expect(await listing()).toEqual(['firms.json', 'meta.json', 'quakes.json', 'watches.json']);
  });

  it('restores the files already replaced when a later rename fails (the Windows EPERM case)', async () => {
    await seedOld();
    await nodeFs.rm(at('quakes.json')); // a target that did not exist before is removed again
    const fs = failingFs({ renameTo: (to) => to.endsWith('meta.json') });
    const err = await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtomicWriteError);
    expect(err).toMatchObject({ state: 'restored', kept: [] });
    expect((err as Error).message).toMatch(
      /^writing meta\.json failed \(EPERM: .*\); the files already replaced \(firms\.json, quakes\.json\) were put back, so every file is unchanged$/,
    );
    expect(await read('firms.json')).toBe('OLD firms');
    expect(await read('meta.json')).toBe('OLD meta');
    expect(await read('watches.json')).toBe('OLD watches');
    expect(await listing()).toEqual(['firms.json', 'meta.json', 'watches.json']);
  });

  it('reports nothing replaced when the first rename fails', async () => {
    await seedOld();
    const fs = failingFs({ renameTo: (to) => to.endsWith('firms.json') });
    const err = await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e);
    expect(err).toMatchObject({ state: 'unchanged' });
    expect((err as Error).message).toMatch(/no file had been replaced yet, so every file is unchanged$/);
    expect(await read('firms.json')).toBe('OLD firms');
    expect(await listing()).toEqual(['firms.json', 'meta.json', 'quakes.json', 'watches.json']);
  });

  it('replaces nothing when a temp file cannot be written', async () => {
    await seedOld();
    const fs = failingFs({ writeTo: (p) => p.includes('meta.json.') });
    const err = await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e);
    expect(err).toMatchObject({ state: 'unchanged' });
    expect((err as Error).message).toMatch(/^could not prepare the new files \(ENOSPC: .*\); nothing was replaced$/);
    for (const name of ['firms', 'quakes', 'meta', 'watches']) expect(await read(`${name}.json`)).toBe(`OLD ${name}`);
    expect(await listing()).toEqual(['firms.json', 'meta.json', 'quakes.json', 'watches.json']);
  });

  it('says which backups to restore by hand when the restore fails too', async () => {
    await seedOld();
    // watches.json cannot be replaced, and firms.json cannot be put back from its backup.
    const fs = failingFs({ renameTo: (to, from) => to.endsWith('watches.json') || (to.endsWith('firms.json') && from.endsWith('.bak')) });
    const err = await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtomicWriteError);
    const e = err as AtomicWriteError;
    expect(e.state).toBe('restore-failed');
    expect(e.message).toMatch(/^writing watches\.json failed \(EPERM: .*\), and restoring failed for firms\.json \(EPERM: .*\)\. The files are now a mix of old and new\.$/);
    expect(e.kept).toHaveLength(1);
    expect(e.kept[0].target).toBe(at('firms.json'));
    expect(e.kept[0].backup).toMatch(/firms\.json\.[^.]+\.bak$/);
    // The backup really holds the previous file; the others were put back.
    expect(await nodeFs.readFile(e.kept[0].backup, 'utf8')).toBe('OLD firms');
    expect(await read('firms.json')).toBe('NEW firms');
    expect(await read('quakes.json')).toBe('OLD quakes');
    expect(await read('meta.json')).toBe('OLD meta');
    expect(await read('watches.json')).toBe('OLD watches');
    expect(await listing()).toEqual(['firms.json', path.basename(e.kept[0].backup), 'meta.json', 'quakes.json', 'watches.json'].sort());
  });

  it('never reuses a backup name from an earlier failed run', async () => {
    await seedOld();
    const fs = failingFs({ renameTo: (to, from) => to.endsWith('meta.json') || (to.endsWith('firms.json') && from.endsWith('.bak')) });
    const first = (await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e)) as AtomicWriteError;
    expect(first.state).toBe('restore-failed');
    const second = (await writeAllOrNothing(NEW_FILES(), { fs }).catch((e: unknown) => e)) as AtomicWriteError;
    expect(second.kept[0].backup).not.toBe(first.kept[0].backup);
    expect(await nodeFs.readFile(first.kept[0].backup, 'utf8')).toBe('OLD firms');
  });
});
