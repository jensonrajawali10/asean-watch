// Vercel Function: GET /api/dsda (same-origin relay for Jakarta DSDA's Posko Banjir floodgate XML).
// DSDA's host presents a certificate browsers do not trust (net::ERR_CERT_AUTHORITY_INVALID), so the
// browser asks this relay instead. TLS verification stays on: while the certificate is untrusted the
// relay answers { available: false, reason: 'certificate' } and the app shows the HISTORICAL snapshot.
// The logic lives in src/lib/dsdaProxy.ts, bundled into api/_lib/dsda-core.js by `npm run build:api`
// (also run by `npm run build`). The client sends no URL and no parameters. No secrets are used.
import { clientIpFrom, handleDsdaRequest } from './_lib/dsda-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleDsdaRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
