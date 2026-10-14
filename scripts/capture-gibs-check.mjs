#!/usr/bin/env node
// Test-time check of the NASA GIBS layers used by src/lib/gibs.ts: npm run check:gibs
// Downloads the EPSG:3857 WMTS GetCapabilities (~6 MB, never fetched by the app), confirms each layer
// identifier, TileMatrixSet, format and time step, and records the latest advertised time into
// data/gibs-snapshot.json (src/lib/gibs.test.ts checks the config against it). Fail-safe: nothing is
// written unless every layer is found.
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../data/gibs-snapshot.json', import.meta.url);
const CAPS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';
const LAYERS = ['Himawari_AHI_Band13_Clean_Infrared', 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'MODIS_Terra_CorrectedReflectance_TrueColor'];

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const res = await fetch(CAPS, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const layers = {};
  for (const id of LAYERS) {
    const at = xml.indexOf(`<ows:Identifier>${id}</ows:Identifier>`);
    if (at < 0) throw new Error(`layer ${id} not in capabilities`);
    const block = xml.slice(at, xml.indexOf('</Layer>', at));
    const values = [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1]);
    layers[id] = {
      tileMatrixSet: /<TileMatrixSet>([^<]+)<\/TileMatrixSet>/.exec(block)?.[1] ?? null,
      format: /<Format>([^<]+)<\/Format>/.exec(block)?.[1] ?? null,
      defaultTime: /<Default>([^<]+)<\/Default>/.exec(block)?.[1] ?? null,
      lastRange: values.at(-1) ?? null,
      template: /resourceType=["']tile["']\s+template=["']([^"']+\{Time\}[^"']+)["']/.exec(block)?.[1] ?? null,
    };
  }
  const snapshot = { checkedAt: iso(Date.now()), capabilities: CAPS, layers };
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`check:gibs: ${JSON.stringify(layers, null, 2)}`);
}

main().catch((err) => {
  console.error(`check:gibs: ${err instanceof Error ? err.message : err}; nothing written`);
  process.exitCode = 1;
});
