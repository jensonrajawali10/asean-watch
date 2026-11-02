// Vercel Function: GET /api/thaiwater (cached relay for ThaiWater's water-level list, waterlevel_load).
// ThaiWater sometimes answers browsers that call it directly with HTTP 429, which printed a console error
// and dropped the app to its snapshot. This relay is cached at the Vercel CDN for ten minutes. The logic
// lives in src/lib/thaiwaterProxy.ts, bundled into api/_lib/thaiwater-core.js by `npm run build:api` (also
// run by `npm run build`). The client sends no URL and no parameters. No secrets are used.
import { clientIpFrom, handleThaiWaterRequest } from './_lib/thaiwater-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleThaiWaterRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
