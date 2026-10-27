// Vercel Function: GET /api/fires (cached relay for NASA FIRMS active fires). FIRMS sends no CORS headers
// and the fire view needs four 7-day CSVs of about 8 MB each, so this relay builds the same snapshot
// scripts/refresh-fires.mjs writes and keeps it at the Vercel CDN for a few hours: the map's fires stay
// current between deploys without committed data. The logic lives in src/lib/firesProxy.ts, bundled into
// api/_lib/fires-core.js by `npm run build:api` (also run by `npm run build`). It takes no parameters.
// No secrets are used.
import { clientIpFrom, handleFiresRequest } from './_lib/fires-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleFiresRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
