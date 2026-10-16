// Server entry for GET /api/ptwc (bundled into api/_lib/ptwc-core.js by scripts/build-api.mjs and
// imported by api/ptwc.ts). The proxy logic lives in src/lib/ptwcProxy.ts; this wrapper only makes
// sure an error response never echoes upstream detail (HTTP status, Node fetch or timeout text) to
// visitors. Server errors are answered with a fixed message and the detail goes to the server log.
// No secrets are involved. The client (src/lib/ptwc.ts) ignores the message and shows its own
// "Official feed unavailable: check ... directly" line.
import { clientIpFrom, handlePtwcRequest as handlePtwcProxyRequest } from '../lib/ptwcProxy';
import type { PtwcContext } from '../lib/ptwcProxy';

export { clientIpFrom };
export type { PtwcContext };

export const PTWC_UNAVAILABLE_MESSAGE = 'PTWC feed unavailable: check https://www.tsunami.gov/ directly.';

/** Error code and detail from a proxy error body (for the log only). */
async function errorDetail(res: Response): Promise<{ code: string; detail: string }> {
  try {
    const body = (await res.clone().json()) as { error?: unknown; message?: unknown } | null;
    return {
      code: typeof body?.error === 'string' ? body.error : 'upstream_unavailable',
      detail: typeof body?.message === 'string' ? body.message : 'no detail',
    };
  } catch {
    return { code: 'upstream_unavailable', detail: 'unreadable error body' };
  }
}

export async function handlePtwcRequest(request: Request, ctx: PtwcContext): Promise<Response> {
  const res = await handlePtwcProxyRequest(request, ctx);
  if (res.status < 500) return res;
  const { code, detail } = await errorDetail(res);
  console.error(`ptwc: HTTP ${res.status} ${code}: ${detail.replace(/\s+/g, ' ').slice(0, 500)}`);
  const headers = new Headers(res.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify({ error: 'upstream_unavailable', message: PTWC_UNAVAILABLE_MESSAGE }), { status: res.status, headers });
}
