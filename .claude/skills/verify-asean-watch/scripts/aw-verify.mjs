#!/usr/bin/env node
// aw-verify: drive ASEAN Watch the way a user does and keep the proof.
// The helper behind .claude/skills/verify-asean-watch/SKILL.md. Run `npm run verify -- help`.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ART_ROOT = join(ROOT, 'verify-artifacts');
const STATE_FILE = join(ART_ROOT, '.server.json');
const SERVER_LOG = join(ART_ROOT, '.server.log');
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const DEFAULT_PORT = 5199;

const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const JOURNEYS = ['map', 'layers', 'cards', 'workspace'];
// Cities tried in order for the city card: the first whose circle is on screen and not under a button wins.
const CITY_PREFERENCE = ['palangka-raya', 'pekanbaru', 'jambi', 'kuching', 'pontianak', 'singapore', 'kuala-lumpur', 'bangkok'];
const VOLCANO_PREFERENCE = ['Merapi', 'Semeru', 'Anak Krakatau', 'Sinabung'];

const HELP = `aw-verify: drive the ASEAN Watch map like a user and keep the proof.

Usage: npm run verify -- <command> [options]

Commands
  run       Default. Start a private dev server (unless one from 'launch' is up), drive the
            journeys at each viewport, save screenshots + report.json, stop what it started.
  open      One view by its link, e.g. --hash "ws=fires" or --hash "sel=city:singapore".
            Saves a screenshot and an ARIA snapshot; prints the card, drawer and page errors.
  launch    Start a private Vite dev server for this checkout and leave it up. Prints JSON.
  doctor    Read-only: is the launched server up, ours, and serving this checkout? Is a browser found?
  stop      Stop the server that 'launch' started (by its recorded PID, never by name).
  help      This text.

Options for run
  --journey <list>     Comma list of ${JOURNEYS.join(', ')} (default: all).
  --viewport <list>    Comma list of desktop (1366x768), phone (375x812) (default: both).
  --theme dark|light   Colour scheme the browser reports (default: dark).
  --url <url>          Drive an already-running server instead (e.g. http://localhost:5173).
                       Read-only journeys only; it is never stopped.
  --out <dir>          Evidence folder (default: verify-artifacts/<run-id>).
  --headed             Show the browser window.
  --keep               Leave the server running after the run (stop it with 'stop').

Options for open
  --hash <h>           The part after # (ws=<section>, sel=<selection>, or both joined by &).
  --viewport <v>       desktop or phone (default desktop). --theme, --url, --out, --headed, --keep as for run.

Options for launch
  --port <n>           Port to try first (default ${DEFAULT_PORT}; the next free one is used if taken).

Output
  Every command prints one JSON object on stdout; progress goes to stderr.
  run exits 0 when every step passed and the page logged no errors, 1 when anything failed,
  2 when it could not start (no browser, server would not come up).
  Evidence: <out>/report.json, <out>/index.html (open it to see every screenshot), <out>/*.png.

Browser
  Uses Playwright's own Chromium when installed, otherwise the installed Chrome, then Edge.
  Force one with AW_VERIFY_BROWSER=chromium|chrome|msedge.
`;

// ---------------------------------------------------------------------------------------------
// Small helpers

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const log = (msg) => process.stderr.write(`${msg}\n`);
const print = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runId() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function checkout() {
  return { root: ROOT, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), commit: git(['rev-parse', '--short', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) };
}

function portFree(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => res(true)));
  });
}

async function findPort(start) {
  for (let p = start; p < start + 100; p++) if (await portFree(p)) return p;
  throw new Error(`No free port between ${start} and ${start + 99}. Pass --port <n> with a free port.`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PID listening on a local TCP port, or null. */
function listenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) return Number(cols[4]);
      }
      return null;
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return Number(out.split(/\s+/)[0]) || null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

/** Repo-relative path with forward slashes, for JSON output on any OS. */
const relPath = (p) => relative(ROOT, p).split(sep).join('/');

const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null);

async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const body = await res.text();
    return res.ok && body.includes('id="root"');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Server

async function startServer(preferredPort) {
  if (!existsSync(VITE_BIN)) throw new Error(`Vite is not installed in ${ROOT}. Run 'npm ci' first.`);
  mkdirSync(ART_ROOT, { recursive: true });
  const port = await findPort(preferredPort);
  const logFd = openSync(SERVER_LOG, 'w');
  const child = spawn(process.execPath, [VITE_BIN, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  const url = `http://127.0.0.1:${port}/`;
  const state = { pid: child.pid, port, url, root: ROOT, log: SERVER_LOG, startedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) break;
    if (await httpOk(url)) return state;
    await sleep(500);
  }
  killTree(child.pid);
  rmSync(STATE_FILE, { force: true });
  const tail = existsSync(SERVER_LOG) ? readFileSync(SERVER_LOG, 'utf8').split(/\r?\n/).slice(-15).join('\n') : '';
  throw new Error(`Dev server did not answer at ${url} within 60 s. Last log lines:\n${tail}`);
}

function stopServer(state) {
  if (!state) return { stopped: false, reason: 'no server recorded in verify-artifacts/.server.json' };
  const wasAlive = alive(state.pid);
  killTree(state.pid);
  rmSync(STATE_FILE, { force: true });
  return { stopped: wasAlive, pid: state.pid, port: state.port };
}

async function doctor() {
  const state = readState();
  const report = { checkout: checkout(), node: process.version, server: null, browser: null, ok: false, advice: [] };
  if (!state) {
    report.server = { recorded: false };
    report.advice.push("No launched server. 'run' starts its own; or run 'launch' first.");
  } else {
    const listener = listenerPid(state.port);
    report.server = {
      recorded: true,
      url: state.url,
      pid: state.pid,
      processAlive: alive(state.pid),
      portListenerPid: listener,
      portOwnedByUs: listener === state.pid,
      sameCheckout: resolve(state.root) === ROOT,
      answers: await httpOk(state.url),
      startedAt: state.startedAt,
    };
    if (!report.server.processAlive) report.advice.push("Recorded server is gone. Run 'stop' to clear the record, then 'launch'.");
    else if (!report.server.portOwnedByUs) report.advice.push(`Port ${state.port} is held by PID ${listener}, not ours (${state.pid}). Do not drive it; run 'stop' then 'launch'.`);
    if (!report.server.sameCheckout) report.advice.push(`Server was started from ${state.root}, not this checkout.`);
  }
  try {
    const { browser, name } = await openBrowser(false);
    report.browser = { name, version: browser.version() };
    await browser.close();
  } catch (e) {
    report.browser = { error: e.message };
    report.advice.push("No usable browser. Install Chrome, or run 'npx playwright install chromium'.");
  }
  const s = report.server;
  report.ok = Boolean(report.browser?.name) && (!s?.recorded || (s.processAlive && s.portOwnedByUs && s.sameCheckout && s.answers));
  return report;
}

// ---------------------------------------------------------------------------------------------
// Browser

async function openBrowser(headed) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error("Playwright is not installed. Run 'npm ci' in the repo root.");
  }
  const forced = process.env.AW_VERIFY_BROWSER;
  const order = forced ? [forced] : ['chromium', 'chrome', 'msedge'];
  const errors = [];
  for (const name of order) {
    try {
      const opts = { headless: !headed };
      if (name !== 'chromium') opts.channel = name;
      return { browser: await chromium.launch(opts), name };
    } catch (e) {
      errors.push(`${name}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error(`No browser could start. ${errors.join(' | ')}`);
}

// ---------------------------------------------------------------------------------------------
// Journeys. Each step records what was done, what was seen, screenshots, and the errors the page
// logged while it ran. Selectors are the app's own accessible names and classes (see features/).

class Session {
  constructor(page, vpName, outDir, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
    this.vp = vpName;
    this.outDir = outDir;
    this.steps = [];
    this.errors = [];
    this.network = [];
    this.shotN = 0;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      const loc = m.location();
      (text.startsWith('Failed to load resource') ? this.network : this.errors).push({ kind: 'console', text, url: loc?.url ?? null });
    });
    page.on('pageerror', (e) => this.errors.push({ kind: 'pageerror', text: e.message }));
    page.on('response', (r) => {
      if (r.status() >= 400) this.network.push({ kind: 'http', status: r.status(), url: r.url() });
    });
    page.on('requestfailed', (r) => {
      const f = r.failure()?.errorText ?? '';
      if (!/ERR_ABORTED/.test(f)) this.network.push({ kind: 'requestfailed', error: f, url: r.url() });
    });
  }

  async shot(rec, label) {
    this.shotN += 1;
    const file = `${this.vp}-${String(this.shotN).padStart(2, '0')}-${label}.png`;
    await this.page.screenshot({ path: join(this.outDir, file) });
    rec.screenshots.push(file);
    return file;
  }

  /** status: pass, fail, or skip (the entry point does not exist at this viewport; `skipped` says why). */
  async step(id, fn) {
    const rec = { id, viewport: this.vp, status: 'fail', ms: 0, did: [], saw: {}, screenshots: [], errors: [] };
    const e0 = this.errors.length;
    const t0 = Date.now();
    log(`  [${this.vp}] ${id} ...`);
    try {
      await fn(rec);
      rec.status = 'pass';
    } catch (e) {
      if (e instanceof Skip) {
        rec.status = 'skip';
        rec.skipped = e.message;
      } else rec.error = e.message.split('\n')[0];
      try {
        await this.shot(rec, `${id.replace(/[^a-z0-9-]+/gi, '-')}-${rec.status === 'skip' ? 'SKIPPED' : 'FAILED'}`);
      } catch {
        /* page gone */
      }
    }
    rec.errors = this.errors.slice(e0);
    if (rec.errors.length) rec.status = 'fail';
    rec.ms = Date.now() - t0;
    const tail = rec.status === 'pass' ? 'ok' : rec.status === 'skip' ? `SKIPPED: ${rec.skipped}` : `FAILED: ${rec.error ?? `${rec.errors.length} page error(s)`}`;
    log(`  [${this.vp}] ${id} ${tail} (${rec.ms} ms)`);
    this.steps.push(rec);
    return rec;
  }
}

/** Thrown when a journey's entry point does not exist at this viewport. Never thrown to hide a failure. */
class Skip extends Error {}

const hashOf = (page) => page.evaluate(() => decodeURIComponent(window.location.hash));

async function waitForMap(page) {
  await page.waitForSelector('.mv-overlay[data-ready="true"]', { timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the map'), null, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await sleep(800); // let the first particle frames and label placement settle
}

/** Reload the map at its regional view with nothing selected (a card zooms the map in). */
async function baseline(s, rec) {
  await s.page.goto(s.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForMap(s.page);
  rec?.did.push('reload the map at its starting view');
}

async function noSidewaysScroll(page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

/** The visible map card, or null. */
async function openCard(page) {
  const card = page.locator('section.mcard').first();
  if (!(await card.isVisible().catch(() => false))) return null;
  return {
    title: await card.getAttribute('aria-label'),
    className: await card.getAttribute('class'),
    text: (await card.innerText()).replace(/\s+/g, ' ').trim().slice(0, 400),
  };
}

/**
 * A card the user can actually see: its middle is not under the workspace sheet or another panel.
 * Playwright calls an element "visible" even when something covers it, so check the hit point.
 */
async function expectCardOnTop(page) {
  const coveredBy = await page.evaluate(() => {
    const card = document.querySelector('section.mcard');
    if (!card) return 'no card';
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 40);
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'off screen';
    const el = document.elementFromPoint(x, y);
    if (!el || card.contains(el)) return null;
    if (el.closest('.ws-drawer')) return 'the workspace sheet';
    const owner = el.closest('[aria-label]');
    return String(owner?.getAttribute('aria-label') ?? (el.className || el.tagName)).slice(0, 60);
  });
  if (coveredBy) throw new Error(`the card opened but the user cannot see it: covered by ${coveredBy}`);
}

async function closeCard(page) {
  const btn = page.locator('section.mcard button[aria-label^="Close"]').first();
  if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 5_000 });
  else await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('section.mcard'), null, { timeout: 5_000 });
}

async function closeDrawer(page) {
  const btn = page.getByRole('button', { name: 'Close the workspace (Esc)' });
  if (await btn.isVisible().catch(() => false)) await btn.click();
  else await page.keyboard.press('Escape');
  await page.waitForSelector('.app[data-drawer="closed"]', { timeout: 5_000 });
}

/**
 * Fit the map's screen projection from the app's own overlay anchors: every [data-lon][data-lat]
 * element is translated to exactly map.project([lon, lat]). North-up web mercator is linear in lon
 * and in mercator y, so two or more anchors give the transform; the residual says if the map is
 * rotated or pitched (then canvas clicks are not trustworthy).
 */
async function fitProjection(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('.mv-overlay');
    if (!overlay) return null;
    const o = overlay.getBoundingClientRect();
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const pts = [];
    for (const el of overlay.querySelectorAll('[data-lon][data-lat]')) {
      if (el.dataset.off === '1') continue;
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
      if (!m) continue;
      pts.push({ lon: Number(el.dataset.lon), my: merc(Number(el.dataset.lat)), x: Number(m[1]), y: Number(m[2]) });
    }
    if (pts.length < 2) return null;
    const lsq = (xs, ys) => {
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
      }
      const a = sxx === 0 ? 0 : sxy / sxx;
      return { a, b: my - a * mx };
    };
    const fx = lsq(pts.map((p) => p.lon), pts.map((p) => p.x));
    const fy = lsq(pts.map((p) => p.my), pts.map((p) => p.y));
    let worst = 0;
    for (const p of pts) worst = Math.max(worst, Math.hypot(fx.a * p.lon + fx.b - p.x, fy.a * p.my + fy.b - p.y));
    return { fx, fy, ox: o.left, oy: o.top, anchors: pts.length, residualPx: Number(worst.toFixed(2)) };
  });
}

function project(fit, lon, lat) {
  const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x: fit.ox + fit.fx.a * lon + fit.fx.b, y: fit.oy + fit.fy.a * my + fit.fy.b };
}

/** True when a click at (x, y) lands on the map canvas, not on a button, card or panel. */
async function hitsCanvas(page, x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return Boolean(el && el.tagName === 'CANVAS');
  }, [x, y]);
}

async function journeyMap(s) {
  const { page } = s;
  await s.step('map-load', async (rec) => {
    rec.did.push(`open ${page.url()}`);
    await waitForMap(page);
    rec.saw.title = await page.title();
    rec.saw.headline = (await page.locator('h1').first().innerText().catch(() => '')).trim();
    const alerts = page.locator('button.alerts-pill');
    rec.saw.alertsButton = (await alerts.count()) ? await alerts.first().getAttribute('title') : null;
    if (!rec.saw.alertsButton) throw new Error('no official-alerts button in the header');
    rec.saw.volcanoMarkers = await page.locator('button.mv-marker.is-volcano').count();
    rec.saw.warningPins = await page.locator('button.mv-wmarker').count();
    rec.saw.layout = await noSidewaysScroll(page);
    if (rec.saw.layout.scrollWidth > rec.saw.layout.innerWidth + 1) throw new Error(`page scrolls sideways: ${rec.saw.layout.scrollWidth}px wide in a ${rec.saw.layout.innerWidth}px window`);
    if (!rec.saw.headline) throw new Error('no page heading (h1) found');
    await s.shot(rec, 'map');
  });
}

async function journeyLayers(s) {
  const { page } = s;
  const group = page.getByRole('group', { name: 'Map layers' });
  await s.step('layers-chips', async (rec) => {
    if (!(await group.isVisible().catch(() => false))) {
      // Phones tuck the chips behind the details toggle.
      const details = page.getByRole('button', { name: /Show the forecast timeline|Show details/ }).first();
      if (await details.isVisible().catch(() => false)) {
        rec.did.push('tap the details toggle to reveal the layer chips');
        await details.click();
      }
      await group.waitFor({ state: 'visible', timeout: 5_000 });
    }
    const chips = group.locator('button[aria-pressed]');
    const n = await chips.count();
    if (n === 0) throw new Error('no layer chips found');
    rec.saw.chips = [];
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      const label = (await chip.innerText()).trim();
      const before = await chip.getAttribute('aria-pressed');
      await chip.click();
      await page.waitForFunction(([el, b]) => el.getAttribute('aria-pressed') !== b, [await chip.elementHandle(), before], { timeout: 5_000 });
      const after = await chip.getAttribute('aria-pressed');
      const file = await s.shot(rec, `chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${after === 'true' ? 'on' : 'off'}`);
      await chip.click();
      await page.waitForFunction(([el, b]) => el.getAttribute('aria-pressed') === b, [await chip.elementHandle(), before], { timeout: 5_000 });
      rec.saw.chips.push({ label, before, toggledTo: after, restored: before, screenshot: file });
      rec.did.push(`toggle "${label}" ${before} -> ${after} -> ${before}`);
    }
  });
  await s.step('layers-more', async (rec) => {
    const more = group.locator('button.mv-chip--more');
    if (!(await more.count())) throw new Error('no "More layers" chip');
    rec.saw.label = (await more.innerText()).trim();
    await more.click();
    rec.did.push(`click "${rec.saw.label}"`);
    await page.waitForSelector('.app[data-drawer="open"]', { timeout: 5_000 });
    rec.saw.drawerTitle = (await page.locator('#ws-drawer-title').innerText()).trim();
    rec.saw.hash = await hashOf(page);
    if (!rec.saw.hash.includes('ws=layers')) throw new Error(`expected #ws=layers, got "${rec.saw.hash}"`);
    await s.shot(rec, 'more-layers');
    await closeDrawer(page);
  });
}

async function journeyCards(s, cities) {
  const { page } = s;
  await s.step('card-volcano', async (rec) => {
    await baseline(s, rec);
    // At phone width the Java volcanoes overlap; tap the first triangle whose centre is not under another tag.
    const tried = [];
    let picked = null;
    for (const name of VOLCANO_PREFERENCE) {
      const marker = page.locator(`button.mv-marker.is-volcano[aria-label^="${name},"]`);
      const box = (await marker.count()) ? await marker.boundingBox() : null;
      if (!box) {
        tried.push(`${name}: not on the map`);
        continue;
      }
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const hit = await page.evaluate(([px, py, n]) => {
        const el = document.elementFromPoint(px, py);
        const btn = el?.closest('button');
        return btn?.getAttribute('aria-label')?.startsWith(`${n},`) ? null : (btn?.getAttribute('aria-label') ?? el?.className ?? 'nothing').toString().slice(0, 60);
      }, [x, y, name]);
      if (hit) {
        tried.push(`${name}: covered by "${hit}"`);
        continue;
      }
      rec.saw.marker = await marker.getAttribute('aria-label');
      await page.mouse.click(x, y);
      rec.did.push(`click the ${name} volcano triangle at (${x.toFixed(0)}, ${y.toFixed(0)})`);
      picked = name;
      break;
    }
    rec.saw.tried = tried;
    if (!picked) throw new Error(`no volcano triangle could be clicked (${tried.join('; ')})`);
    await page.waitForSelector('section.mcard', { timeout: 5_000 });
    await expectCardOnTop(page);
    rec.saw.card = await openCard(page);
    rec.saw.hash = await hashOf(page);
    if (!(rec.saw.card?.title ?? '').toLowerCase().includes(picked.toLowerCase())) throw new Error(`card title is "${rec.saw.card?.title}", expected ${picked}`);
    await s.shot(rec, 'volcano-card');
    await closeCard(page);
    rec.did.push('close the card');
  });

  await s.step('card-city', async (rec) => {
    await baseline(s, rec);
    const fit = await fitProjection(page);
    if (!fit) throw new Error('could not read the map projection from the overlay anchors');
    rec.saw.projection = { anchors: fit.anchors, residualPx: fit.residualPx };
    if (fit.residualPx > 2) throw new Error(`map looks rotated or pitched (fit residual ${fit.residualPx}px); reset north and retry`);
    const vp = page.viewportSize();
    const tried = [];
    for (const id of CITY_PREFERENCE) {
      const c = cities.find((x) => x.id === id);
      if (!c) continue;
      const pt = project(fit, c.lon, c.lat);
      if (pt.x < 8 || pt.y < 8 || pt.x > vp.width - 8 || pt.y > vp.height - 8) {
        tried.push(`${c.name}: off screen`);
        continue;
      }
      if (!(await hitsCanvas(page, pt.x, pt.y))) {
        tried.push(`${c.name}: covered by a control at (${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`);
        continue;
      }
      await page.mouse.click(pt.x, pt.y);
      rec.did.push(`click the ${c.name} circle at (${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`);
      const opened = await page.waitForSelector('section.mcard', { timeout: 3_000 }).catch(() => null);
      if (!opened) {
        tried.push(`${c.name}: click opened no card`);
        continue;
      }
      rec.saw.city = c.name;
      await expectCardOnTop(page);
      rec.saw.card = await openCard(page);
      rec.saw.hash = await hashOf(page);
      rec.saw.tried = tried;
      if (!rec.saw.hash.includes(`city:${c.id}`)) throw new Error(`card opened but hash is "${rec.saw.hash}", expected sel=city:${c.id}`);
      await s.shot(rec, 'city-card');
      await closeCard(page);
      rec.did.push('close the card');
      return;
    }
    rec.saw.tried = tried;
    throw new Error(`no city circle could be clicked (${tried.join('; ')})`);
  });

  await s.step('card-fire', async (rec) => {
    await baseline(s, rec);
    // The simple view (the default) hides the fire-count badges; "Show details" brings them back.
    const details = page.getByRole('button', { name: 'Show details', exact: true });
    const simpleFirst = await details.isVisible().catch(() => false);
    if (simpleFirst) {
      await details.click();
      rec.did.push('click "Show details"');
    }
    try {
      const badges = page.locator('button.mv-fbadge');
      await badges.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
      const n = await badges.count();
      rec.saw.badges = n;
      let clicked = null;
      const tried = [];
      for (let i = 0; i < n && !clicked; i++) {
        const b = badges.nth(i);
        const box = await b.boundingBox();
        if (!box) continue;
        const label = await b.getAttribute('aria-label');
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const ownHit = await page.evaluate(([px, py, l]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label') === l, [x, y, label]);
        if (!ownHit) {
          tried.push(`"${label}": covered`);
          continue;
        }
        await page.mouse.click(x, y);
        clicked = label;
      }
      rec.saw.tried = tried;
      // The label planner drops badges it cannot fit beside the header and dock (phones): no badge, no entry point.
      if (!n) throw new Skip('no fire badge fits on the map at this size; reach fire cards from the Fires section here');
      if (!clicked) throw new Error(`every fire badge is covered (${tried.join('; ')})`);
      rec.saw.entry = 'map fire badge';
      rec.saw.badge = clicked;
      rec.did.push(`click the fire badge "${clicked}"`);
      await expectFireCard(s, rec);
    } finally {
      if (simpleFirst) {
        await page.getByRole('button', { name: 'Simple view', exact: true }).click().catch(() => {});
        rec.did.push('click "Simple view" to go back');
      }
    }
  });

  await s.step('card-fire-list', async (rec) => {
    await baseline(s, rec);
    await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name: 'Fires', exact: true }).click();
    rec.did.push('click "Fires" in the workspace rail');
    const fly = page.locator('ol.fires-clusters button.fires-fly').first();
    await fly.waitFor({ state: 'visible', timeout: 10_000 });
    rec.saw.row = (await fly.innerText()).replace(/\s+/g, ' ').trim();
    await fly.click();
    rec.did.push(`click "${rec.saw.row}" in the top fire clusters list`);
    rec.saw.entry = 'Fires section "Fly to"';
    await expectFireCard(s, rec);
  });
}

async function expectFireCard(s, rec) {
  const { page } = s;
  await page.waitForSelector('section.mcard', { timeout: 5_000 });
  await sleep(1200); // the map flies to the fire; let it land before the screenshot
  await expectCardOnTop(page);
  rec.saw.card = await openCard(page);
  rec.saw.hash = await hashOf(page);
  if (!rec.saw.hash.includes('sel=fire:')) throw new Error(`card opened but hash is "${rec.saw.hash}", expected sel=fire:...`);
  await s.shot(rec, `fire-card-${rec.id === 'card-fire' ? 'map' : 'list'}`);
  await closeCard(page);
  rec.did.push('close the card');
}

async function journeyWorkspace(s) {
  const { page } = s;
  await baseline(s);
  const rail = page.getByRole('navigation', { name: 'Workspace sections' });
  const buttons = rail.getByRole('button');
  const names = [];
  for (let i = 0; i < (await buttons.count()); i++) names.push(await buttons.nth(i).getAttribute('aria-label'));
  for (const name of names) {
    if (!name || name === 'Map') continue;
    const short = name.replace(/\s*\(.*$/, '');
    await s.step(`workspace-${short.toLowerCase()}`, async (rec) => {
      await rail.getByRole('button', { name, exact: true }).click();
      rec.did.push(`click "${name}" in the left rail`);
      await page.waitForSelector('.app[data-drawer="open"]', { timeout: 5_000 });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await sleep(300);
      rec.saw.drawerTitle = (await page.locator('#ws-drawer-title').innerText()).trim();
      rec.saw.hash = await hashOf(page);
      const body = await page.locator('.ws-drawer').innerText();
      rec.saw.chars = body.length;
      if (/could not be shown/i.test(body)) throw new Error('the section shows its error message ("could not be shown")');
      if (!rec.saw.hash.includes('ws=')) throw new Error(`expected #ws=<section>, got "${rec.saw.hash}"`);
      await s.shot(rec, `ws-${short.toLowerCase()}`);
      await closeDrawer(page);
      rec.did.push('close the workspace');
    });
  }
}

// ---------------------------------------------------------------------------------------------
// run

function gallery(report) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = report.steps
    .map((st) => {
      const imgs = st.screenshots.map((f) => `<a href="${f}"><img src="${f}" alt="${esc(f)}" loading="lazy"></a>`).join('');
      const errs = st.errors.length ? `<pre>${esc(st.errors.map((e) => e.text).join('\n'))}</pre>` : '';
      return `<section class="${st.status}"><h2>${st.status.toUpperCase()} · ${esc(st.viewport)} · ${esc(st.id)}</h2>${st.error || st.skipped ? `<p>${esc(st.error ?? st.skipped)}</p>` : ''}<ul>${st.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>${errs}<div class="imgs">${imgs}</div></section>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ASEAN Watch check ${esc(report.runId)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#111;color:#eee}h1{font-size:18px}section{border-left:4px solid #3a3;padding:4px 12px;margin:16px 0}section.fail{border-color:#d33}section.skip{border-color:#aa3}h2{font-size:15px;margin:4px 0}.imgs{display:flex;flex-wrap:wrap;gap:8px}img{max-height:260px;border:1px solid #444}pre{color:#f88;white-space:pre-wrap}</style>
<h1>${report.ok ? 'PASS' : 'FAIL'}: ${report.summary.passed} passed, ${report.summary.failed.length} failed, ${report.summary.skipped.length} skipped · ${esc(report.checkout.branch)} @ ${esc(report.checkout.commit)}${report.checkout.dirty ? ' (uncommitted changes)' : ''} · ${esc(report.finishedAt)}</h1>
<p>${esc(report.url)} · browser ${esc(report.browser)} · ${report.summary.pageErrors} page error(s) · ${report.summary.networkProblems} network problem(s) (in report.json)</p>
${rows}`;
}

/** --url, else the server from 'launch' if it is healthy and ours, else a private one for this command. */
async function acquireServer(args) {
  if (args.url && args.url !== true) return { url: String(args.url), started: null };
  const state = readState();
  if (state && alive(state.pid) && listenerPid(state.port) === state.pid && (await httpOk(state.url))) {
    log(`Using the server from 'launch': ${state.url}`);
    return { url: state.url, started: null };
  }
  log('Starting a private dev server ...');
  const started = await startServer(DEFAULT_PORT);
  log(`Dev server up: ${started.url} (pid ${started.pid})`);
  return { url: started.url, started };
}

function releaseServer(started, args) {
  if (!started || args.keep) return;
  stopServer(started);
  log('Dev server stopped.');
}

/** open: one view by its link (#ws=..., #sel=...), with a screenshot, an ARIA snapshot and the page's errors. */
async function openView(args) {
  const vp = args.viewport && args.viewport !== true ? String(args.viewport) : 'desktop';
  if (!VIEWPORTS[vp]) throw Object.assign(new Error(`Unknown viewport "${vp}". Use desktop or phone.`), { code: 2 });
  const hash = args.hash && args.hash !== true ? String(args.hash).replace(/^#/, '') : '';
  const outDir = resolve(args.out && args.out !== true ? String(args.out) : join(ART_ROOT, `${runId()}-open`));
  mkdirSync(outDir, { recursive: true });
  const { url, started } = await acquireServer(args);
  try {
    const { browser, name } = await openBrowser(Boolean(args.headed));
    try {
      const context = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: args.theme === 'light' ? 'light' : 'dark' });
      const page = await context.newPage();
      const s = new Session(page, vp, outDir, url);
      const target = hash ? `${url}#${hash}` : url;
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await waitForMap(page);
      await sleep(1200);
      const rec = { screenshots: [] };
      await s.shot(rec, hash ? hash.replace(/[^a-z0-9]+/gi, '-') : 'map');
      const aria = `${vp}-open.aria.yml`;
      writeFileSync(join(outDir, aria), await page.locator('body').ariaSnapshot());
      const drawerOpen = (await page.locator('.app[data-drawer="open"]').count()) > 0;
      let cardOnTop = null;
      if (await page.locator('section.mcard').count()) cardOnTop = await expectCardOnTop(page).then(() => true, (e) => e.message);
      const result = {
        ok: s.errors.length === 0,
        url: target,
        viewport: vp,
        browser: `${name} ${browser.version()}`,
        hashNow: await hashOf(page),
        drawer: drawerOpen ? (await page.locator('#ws-drawer-title').innerText()).trim() : null,
        card: await openCard(page),
        cardOnTop,
        pageErrors: s.errors,
        network: s.network,
        screenshot: `${relPath(outDir)}/${rec.screenshots[0]}`,
        aria: `${relPath(outDir)}/${aria}`,
      };
      await context.close();
      print(result);
      return result.ok ? 0 : 1;
    } finally {
      await browser.close();
    }
  } finally {
    releaseServer(started, args);
  }
}

async function run(args) {
  const journeys = args.journey && args.journey !== true ? String(args.journey).split(',') : JOURNEYS;
  const vps = args.viewport && args.viewport !== true ? String(args.viewport).split(',') : Object.keys(VIEWPORTS);
  for (const j of journeys) if (!JOURNEYS.includes(j)) throw Object.assign(new Error(`Unknown journey "${j}". Use one of: ${JOURNEYS.join(', ')}.`), { code: 2 });
  for (const v of vps) if (!VIEWPORTS[v]) throw Object.assign(new Error(`Unknown viewport "${v}". Use desktop or phone.`), { code: 2 });
  const theme = args.theme === 'light' ? 'light' : 'dark';
  const id = runId();
  const outDir = resolve(args.out && args.out !== true ? String(args.out) : join(ART_ROOT, id));
  mkdirSync(outDir, { recursive: true });

  const { url, started } = await acquireServer(args);
  const cities = JSON.parse(readFileSync(join(ROOT, 'data', 'aq-snapshot.json'), 'utf8')).places.filter((p) => p.kind === 'city');

  let browserInfo;
  const all = [];
  const network = [];
  try {
    const { browser, name } = await openBrowser(Boolean(args.headed));
    browserInfo = `${name} ${browser.version()}`;
    log(`Browser: ${browserInfo}`);
    try {
      for (const vp of vps) {
        const context = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: theme });
        const page = await context.newPage();
        const s = new Session(page, vp, outDir, url);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await journeyMap(s);
        // Keep going when the map loaded but logged errors; stop when it never loaded.
        const mapOk = s.steps[0] && !s.steps[0].error;
        if (mapOk) {
          if (journeys.includes('layers')) await journeyLayers(s);
          if (journeys.includes('cards')) await journeyCards(s, cities);
          if (journeys.includes('workspace')) await journeyWorkspace(s);
        }
        all.push(...s.steps);
        network.push(...s.network.map((n) => ({ viewport: vp, ...n })));
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    releaseServer(started, args);
  }

  const failed = all.filter((st) => st.status === 'fail');
  const skipped = all.filter((st) => st.status === 'skip');
  const report = {
    ok: failed.length === 0,
    runId: id,
    finishedAt: new Date().toISOString(),
    url,
    serverStartedByRun: Boolean(started),
    serverKept: Boolean(started && args.keep),
    browser: browserInfo,
    theme,
    checkout: checkout(),
    journeys,
    viewports: vps,
    summary: {
      steps: all.length,
      passed: all.length - failed.length - skipped.length,
      failed: failed.map((st) => `${st.viewport}/${st.id}: ${st.error ?? `${st.errors.length} page error(s)`}`),
      skipped: skipped.map((st) => `${st.viewport}/${st.id}: ${st.skipped}`),
      pageErrors: all.reduce((n, st) => n + st.errors.length, 0),
      networkProblems: network.length,
    },
    artifacts: relPath(outDir),
    steps: all,
    network,
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'index.html'), gallery(report));
  const { steps: _steps, network: _network, ...headline } = report;
  print({ ...headline, report: `${report.artifacts}/report.json`, gallery: `${report.artifacts}/index.html` });
  return report.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? 'run';
  if (cmd === 'help' || args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === 'launch') {
    const state = readState();
    if (state && alive(state.pid) && listenerPid(state.port) === state.pid) {
      print({ ok: true, alreadyRunning: true, ...state });
      return 0;
    }
    const port = args.port && args.port !== true ? Number(args.port) : DEFAULT_PORT;
    print({ ok: true, ...(await startServer(port)) });
    return 0;
  }
  if (cmd === 'stop') {
    print({ ok: true, ...stopServer(readState()) });
    return 0;
  }
  if (cmd === 'doctor') {
    const report = await doctor();
    print(report);
    return report.ok ? 0 : 1;
  }
  if (cmd === 'run') return run(args);
  if (cmd === 'open') return openView(args);
  process.stderr.write(`Unknown command "${cmd}". Run 'npm run verify -- help'.\n`);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    print({ ok: false, error: e.message });
    process.exit(e.code === 2 || /browser|Dev server|Vite is not installed|Playwright/.test(e.message) ? 2 : 1);
  },
);
