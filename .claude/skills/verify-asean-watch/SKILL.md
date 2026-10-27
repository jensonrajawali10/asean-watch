---
name: verify-asean-watch
description: Drive the ASEAN Watch map (the React + Vite web app in this repo) in a real browser at desktop and phone sizes, the way a user does, and keep proof (screenshots, page errors, a JSON report). Use after any change to what the site shows, to reproduce a UI bug, or before calling UI work done.
---

# Verify ASEAN Watch

ASEAN Watch is one web page: a full-screen map (haze, wind, fires, volcanoes, official warning pins) with a left rail that opens an analyst workspace. There is no login, database or seed step: the page reads bundled real-data snapshots from `data/` and asks live public feeds for newer copies. This skill drives that page through `aw-verify`, a small CLI in `scripts/`, and keeps the evidence.

Read [`features/README.md`](features/README.md) before driving anything. Each feature file there says how a user reaches the feature, which `aw-verify` command proves it, and what end state counts as proof.

## Launch

You usually do not launch by hand: `npm run verify` starts its own private Vite dev server, drives it, and stops it.

To keep one server up across several commands:

```bash
npm run verify -- launch            # prints {"ok":true,"pid":...,"port":5199,"url":"http://127.0.0.1:5199/",...}
```

- It runs `node node_modules/vite/bin/vite.js --port <port> --strictPort --host 127.0.0.1` from the repo root. Port 5199 by default; the next free port if 5199 is taken.
- Ready means the page HTML answers with `id="root"`. Each drive then waits for the map itself: `.mv-overlay[data-ready="true"]` and the text "Loading the map" gone.
- State goes to `verify-artifacts/.server.json` (pid, port, url, root) and the server log to `verify-artifacts/.server.log`.
- Needs `npm ci` once (Vite and Playwright come from `devDependencies`). No env vars, keys or seed data.

## Doctor

Run this first whenever anything looks off. It is read-only.

```bash
npm run verify -- doctor
```

It answers: which checkout and commit; whether the recorded server is alive, answers, holds its port (`portOwnedByUs`, from `netstat`/`lsof`) and was started from this checkout; and which browser starts. `ok: false` comes with an `advice` list saying what to do. Never drive a server whose port is not owned by the recorded PID: it is someone else's (Jenson's own `npm run dev` on 5173, or another agent's).

## Drive

```bash
npm run verify                                    # all journeys, desktop 1366x768 and phone 375x812
npm run verify -- run --journey cards --viewport phone
npm run verify -- run --journey layers,workspace --theme light
npm run verify -- open --hash "ws=fires" --viewport phone
npm run verify -- open --hash "sel=city:singapore"
npm run verify -- help
```

- `run` journeys: `map` (always first; includes `fires-live`, which asks `/api/fires` and checks the map key's fire wording), `layers`, `cards`, `workspace`. Step ids and what each proves are in the feature files.
- `open` loads one view by its link. The app keeps state in the URL hash: `ws=<section>` for the open workspace section and `sel=<selection>` for the open card (`sel=watch-merapi`, `sel=city:<id>`, `sel=fire:24h-1`, `sel=warning:<id>`; both together as `ws=fires&sel=fire:24h-1`). It prints the card, the drawer title, page errors, and paths to a screenshot and an ARIA snapshot (`.aria.yml`) you can read to find more handles. `cardOnTop` is `true` when the user can see the card, `null` when no card is open, and otherwise a sentence naming what covers it. `open` exits 0 on a covered card (only page errors fail it), so read `cardOnTop` yourself. On a phone a link with both `ws=` and `sel=` opens the workspace sheet over the card, because the link asks for the section; use `sel=` alone to prove a card there.
- `--url http://localhost:5173` drives a server someone else started. Only read-only journeys exist, so this is safe, and `aw-verify` never stops it.
- Handles are the app's own: accessible names (`Map layers` group, `Close Data & reports (Esc)` on `button.ws-drawer__close`), the rail `nav.taskbar` (named "Data and report sections"; found by class because it has been renamed before), the details toggle `button.detail-toggle` (found by its `title`, since its text is "Show details" on desktop and "Details" on phones), `aria-pressed` on chips, `section.mcard` for map cards (its `aria-label` is the card title), `#ws-drawer-title`, and the URL hash. Cities and fire squares are drawn on the map canvas, so `aw-verify` clicks them by position: it reads the map projection from the overlay buttons (each `[data-lon][data-lat]` element is moved to exactly that point) and refuses to click if the fit says the map is rotated or a control covers the point.
- For an ad-hoc action no journey covers, drive Playwright from a scratch script with the same handles, or use the built-in browser on a `launch`ed server. If you do it twice, add it to `aw-verify` and the feature map instead.

## Evidence

Every `run` writes `verify-artifacts/<run-id>/` (gitignored):

- `report.json`: per step the viewport, `status` (`pass`, `fail`, `skip`), what was done (`did`), what was seen (`saw`: card title and text, URL hash, chip states, drawer title), screenshots, page errors, plus every network problem.
- `index.html`: every step with its screenshots. Open it to review a run by eye.
- `<viewport>-<nn>-<label>.png`: one screenshot per proof point; `-FAILED` / `-SKIPPED` shots show the page at the moment a step stopped.

Proof standards:

- Drive the real user path: clicks on the rail, chips, triangles, circles, badges and list rows. The hash is a real entry point too (shared links), but proving a card through `open --hash` does not prove the click path.
- A card counts as open only when the user can see it: `aw-verify` checks the point under the card's middle belongs to the card, because Playwright calls an element "visible" even when the workspace sheet covers it.
- Capture the action and the resulting state: each step records the URL hash and the card or drawer text next to its screenshot.
- Page errors fail the step: uncaught exceptions and `console.error`. Failed network requests (often a live feed being down) are listed under `network` and do not fail the run; the app falls back to its snapshot. Report them when they matter to the change.
- Data is real and live. Numbers in the screenshots change between runs; prove structure and behaviour, not values. Back-to-back runs can hit Open-Meteo's hourly limit: `/api/open-meteo` then answers 503 (listed under `network`) and the page falls back to its bundled snapshot, so header numbers can differ from the previous run.
- Before/after proof: run the same command on the base branch in a separate worktree (`git worktree add ../aw-before <base-branch>`, then `npm ci` there), with its own `--out`. Never stash or switch branches in a folder someone else is working in. Compare the two `report.json` files step by step.
- `skip` means the entry point does not exist at that size (no fire badge fits on a phone). It is never used to hide a failure. Report skips by name.

`run` exits 0 when nothing failed, 1 when a step failed, 2 when it could not start (no browser, server would not come up). Every command prints one JSON object on stdout; progress goes to stderr.

## Cleanup

- `run` and `open` stop the server they started, by PID (`taskkill /PID <pid> /T /F` on Windows), never by process name. `--keep` leaves it up.
- `npm run verify -- stop` stops the server `launch` started and deletes `verify-artifacts/.server.json`.
- Cleanup never deletes evidence. Old run folders stay in `verify-artifacts/` until someone deletes them by hand.

## Helpers

- `scripts/aw-verify.mjs`, run through `npm run verify -- <command>` (or `node .claude/skills/verify-asean-watch/scripts/aw-verify.mjs <command>`). `help` lists every command and option.
- Browser: Playwright's own Chromium if installed, else the installed Chrome, else Edge. Force one with `AW_VERIFY_BROWSER=chromium|chrome|msedge`. On a machine with neither Chrome nor Edge, run `npx playwright install chromium` once.

## Isolation

Two instances can run side by side: each server takes its own port and `aw-verify` only ever drives and stops the one it recorded. Each viewport gets a fresh browser context (no shared storage), and every card journey reloads the map first, because opening a card flies the map in.

## Keep it honest

When a change adds, renames or removes something a user can reach, update the matching file in `features/` and the journey in `aw-verify.mjs` in the same PR. To audit the whole map against the app, run `/pstack:maintain-verification-skill`.
