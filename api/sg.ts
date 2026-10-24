// Vercel Function: GET /api/sg?feed=wind-direction|wind-speed|psi|pm25|flood-alerts (cached relay for
// data.gov.sg: NEA wind, PSI and PM2.5, and PUB flood alerts). data.gov.sg answers about six keyless
// requests every few seconds per IP and its HTTP 429 carries no CORS header, so browsers that called it
// directly printed CORS errors and fell back to the snapshots after a second tab or a quick reload. This
// relay is cached at the Vercel CDN. The logic lives in src/lib/sgProxy.ts, bundled into
// api/_lib/sg-core.js by `npm run build:api` (also run by `npm run build`). The client names a feed and
// nothing else. No secrets are used.
import { clientIpFrom, handleSgRequest } from './_lib/sg-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleSgRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
