#!/usr/bin/env node
// Capture the Tokyo VAAC advisories for offline fallback: npm run refresh:vaac
// Runs the same builder as the live relay GET /api/vaac (scripts/lib/vaacBuild.mjs): the newest advisory
// per volcano issued in the 24 hours before capture, text word for word. The browser shows it as a
// HISTORICAL snapshot and, like the relay's answer, only the advisories issued in the 24 hours before the
// visitor's clock, so an old capture never looks current. Fail-safe: on any failure nothing is written;
// the file is written atomically (temp file + rename).
//
// VAAC Darwin (the Bureau of Meteorology, which covers Indonesia) is not captured: its terms do not allow
// automated access or passing its text on. See src/lib/volcanoOfficial.ts.
import { writeFileAtomic } from './lib/atomicWrite.mjs';
import { buildVaacData } from './lib/vaacBuild.mjs';

const OUT = new URL('../data/vaac-snapshot.json', import.meta.url);

async function main() {
  const data = await buildVaacData({ timeoutMs: 60_000, log: (line) => console.log(line) });
  const snapshot = {
    capturedAt: data.retrievedAt,
    note: 'HISTORICAL copy of the Tokyo VAAC advisories issued in the 24 hours before capture. Not current: check https://www.data.jma.go.jp/vaac/data/vaac_list.html.',
    ...data,
  };
  await writeFileAtomic(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  const names = data.advisories.map((a) => `${a.volcano} (${a.number})`).join(', ') || 'none in the last 24 h';
  console.log(`refresh:vaac: wrote data/vaac-snapshot.json (${data.advisories.length} advisories: ${names})`);
}

main().catch((err) => {
  console.error(`refresh:vaac: ${err instanceof Error ? err.message : err}; snapshot left unchanged`);
  process.exitCode = 1;
});
