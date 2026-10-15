// Vercel Function: GET /api/ptwc (strict proxy for the PTWC Atom feed and the CAP document it links).
// tsunami.gov sends no CORS headers. The logic lives in src/lib/ptwcProxy.ts (proxy) and
// src/server/ptwcHandler.ts (fixed error messages; detail only in the server log), bundled into
// api/_lib/ptwc-core.js by `npm run build:api` (also run by `npm run build`). The client sends no URL
// and no parameters; only https://www.tsunami.gov is ever fetched. No secrets are used.
import { clientIpFrom, handlePtwcRequest } from './_lib/ptwc-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handlePtwcRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
