// Server-side handler for POST /api/ai-brief ("Summarise with Claude").
// Runs only on the server: on Vercel through api/ai-brief.ts (which imports the bundled copy in
// api/_lib, built by scripts/build-api.mjs) and in local dev through the Vite middleware in
// vite.config.ts. The browser sends only {watchId, dayIndex}; the facts are built here from the
// bundled real data, and the API key is read from the environment passed in by the caller.
import type { BriefingInput } from '../lib/briefing';
import { buildBriefing, replayDayLabel } from '../lib/briefing';
import { findVolcano, loadFixtures } from '../lib/fixtures';
import type { RealFixtures } from '../lib/fixtures';
import { assessDrift, loadNeaSnapshot } from '../lib/nea';
import { deriveReview, visibleObservations } from '../lib/reviewRules';
import { loadWarningsSnapshot, warningsNear } from '../lib/warnings';
import {
  AI_BRIEF_DAY_COUNT,
  AI_BRIEF_FALLBACK_BETA,
  AI_BRIEF_MAX_BODY_BYTES,
  buildAiBriefRequest,
  citationIdsIn,
  resolveAiBriefModel,
  sanitiseAiBriefText,
  sourceUrlsIn,
  validateAiBriefBody,
} from '../lib/aiBrief';
import type { AiBriefError, AiBriefErrorCode, AiBriefSuccess } from '../lib/aiBrief';

/** Same radius the UI uses for "official warnings near this watch area" (App.tsx NEAR_KM). */
export const NEAR_KM = 150;
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_KEYS = 5000;
const UPSTREAM_TIMEOUT_MS = 25_000;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface AiBriefEnv {
  ANTHROPIC_API_KEY?: string;
  AI_BRIEF_MODEL?: string;
}

export interface AiBriefContext {
  env: AiBriefEnv;
  /** Client IP for the rate limit (best effort). */
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Facts: the deterministic brief for one watch area and replay day

let fixturesCache: RealFixtures | null = null;
function fixtures(): RealFixtures {
  fixturesCache ??= loadFixtures();
  return fixturesCache;
}

export function knownWatchIds(): string[] {
  return fixtures().incidents.map((i) => i.id);
}

/** The deterministic text brief (buildBriefing) for a watch and day, from the bundled snapshots only. */
export function buildFactsFor(watchId: string, dayIndex: number): { text: string; contextLine: string } | null {
  const fx = fixtures();
  const incident = fx.incidents.find((i) => i.id === watchId);
  if (!incident) return null;
  const step = fx.replaySteps.find((s) => s.index === dayIndex) ?? null;
  const review = deriveReview(visibleObservations(fx.observations, incident.id, dayIndex), incident.scenarioWindow);
  const nea = loadNeaSnapshot();
  const warnings = loadWarningsSnapshot();
  const input: BriefingInput = {
    incident,
    volcano: findVolcano(fx.volcanoes, incident.volcanoId),
    step,
    review,
    issues: fx.issues,
    nea,
    drift: nea ? assessDrift(incident, nea) : null,
    warnings: warningsNear(warnings.warnings, incident.lat, incident.lon, NEAR_KM),
    warningFeeds: warnings.feeds,
    dataAsOf: fx.snapshot?.retrievedAt || null,
    stepCount: fx.replaySteps.length || undefined,
  };
  const day = step ? replayDayLabel(step, fx.replaySteps.length || AI_BRIEF_DAY_COUNT) : `day index ${dayIndex}`;
  return { text: buildBriefing(input), contextLine: `${incident.title}, ${day}` };
}

// ---------------------------------------------------------------------------
// Rate limit (in memory, per instance, best effort)

const hits = new Map<string, number[]>();

export function resetAiBriefRateLimit(): void {
  hits.clear();
}

/** Records a hit; returns 0 when allowed, else the seconds until the oldest hit leaves the window. */
function rateLimit(ip: string, now: number): number {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  hits.delete(ip);
  hits.set(ip, recent);
  if (hits.size > RATE_LIMIT_MAX_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return 0;
}

/** Client IP from the platform headers (Vercel overwrites these; first hop of x-forwarded-for). */
export function clientIpFrom(headers: Headers, fallback = 'unknown'): string {
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : '');
  return first(headers.get('x-vercel-forwarded-for')) || first(headers.get('x-real-ip')) || first(headers.get('x-forwarded-for')) || fallback;
}

// ---------------------------------------------------------------------------
// HTTP helpers

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(status: number, body: AiBriefSuccess | AiBriefError, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function fail(status: number, error: AiBriefErrorCode, message?: string, extra?: Record<string, string>): Response {
  return json(status, message ? { error, message } : { error }, extra);
}

/** Same-site check: the Origin (required) must match the Host the request was sent to. */
function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  let host = request.headers.get('host');
  if (!host) {
    try {
      host = new URL(request.url).host;
    } catch {
      return false;
    }
  }
  return originHost.toLowerCase() === host.toLowerCase();
}

/** Reads at most limit+1 bytes; returns null when the body is larger than limit. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

interface UpstreamMessage {
  model?: string;
  stop_reason?: string | null;
  content?: Array<{ type?: string; text?: string }>;
}

// ---------------------------------------------------------------------------
// Handler

export async function handleAiBriefRequest(request: Request, ctx: AiBriefContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  try {
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { allow: 'POST' });
    if (!sameOrigin(request)) return fail(403, 'forbidden', 'Cross-site requests are not accepted.');

    const apiKey = (ctx.env.ANTHROPIC_API_KEY ?? '').trim();
    if (!apiKey) return fail(503, 'not_configured', 'AI brief not configured.');

    const retryAfter = rateLimit(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) {
      return json(429, { error: 'rate_limited', message: 'Too many AI brief requests; try again later.', retryAfterSeconds: retryAfter }, {
        'retry-after': String(retryAfter),
      });
    }

    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return fail(415, 'unsupported_media_type', 'Send application/json.');

    const bytes = await readLimited(request, AI_BRIEF_MAX_BODY_BYTES);
    if (bytes === null) return fail(413, 'payload_too_large', `Body must be at most ${AI_BRIEF_MAX_BODY_BYTES} bytes.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return fail(400, 'bad_request', 'Body is not valid JSON.');
    }
    const valid = validateAiBriefBody(parsed, knownWatchIds(), Math.min(fixtures().replaySteps.length || AI_BRIEF_DAY_COUNT, AI_BRIEF_DAY_COUNT));
    if (!valid.ok) return fail(400, 'bad_request', valid.reason);
    const { watchId, dayIndex } = valid.value;

    const facts = buildFactsFor(watchId, dayIndex);
    if (!facts) return fail(400, 'bad_request', 'unknown watchId');

    const body = buildAiBriefRequest(facts.text, { model: resolveAiBriefModel(ctx.env.AI_BRIEF_MODEL), contextLine: facts.contextLine });
    const doFetch = ctx.fetchImpl ?? fetch;
    let upstream: Response;
    try {
      upstream = await doFetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': AI_BRIEF_FALLBACK_BETA,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      console.error('ai-brief: upstream request failed:', err instanceof Error ? err.name : 'unknown error');
      return fail(502, 'upstream_error', 'The AI service could not be reached.');
    }
    if (!upstream.ok) {
      // Log the status only: never the key, never the request body.
      console.error(`ai-brief: upstream HTTP ${upstream.status}`);
      const busy = upstream.status === 429 || upstream.status === 529;
      return fail(502, 'upstream_error', busy ? 'The AI service is busy; try again shortly.' : `The AI service returned HTTP ${upstream.status}.`);
    }
    const message = (await upstream.json()) as UpstreamMessage;
    if (message.stop_reason === 'refusal') return fail(502, 'refused', 'The model declined to summarise this brief.');
    const raw = (message.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    const summary = sanitiseAiBriefText(raw, { allowedUrls: sourceUrlsIn(facts.text), allowedCitations: citationIdsIn(facts.text) });
    if (summary === '') return fail(502, 'upstream_error', 'The AI service returned no text.');
    return json(200, {
      summary,
      model: typeof message.model === 'string' && message.model ? message.model : body.model,
      generatedAt: new Date(now()).toISOString(),
      watchId,
      dayIndex,
      truncated: message.stop_reason === 'max_tokens',
    });
  } catch (err) {
    console.error('ai-brief: internal error:', err instanceof Error ? err.message : String(err));
    return fail(500, 'internal_error', 'The AI brief could not be produced.');
  }
}
