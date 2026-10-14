// Vercel Function: POST /api/ai-brief {watchId, dayIndex}, or GET /api/ai-brief?watchId=&dayIndex=
// (cacheable: 200s carry Cache-Control: public, s-maxage=21600). "Summarise with Claude".
// The logic lives in src/server/aiBriefHandler.ts. It is bundled into api/_lib/ai-brief-core.js
// (generated, gitignored) by `npm run build:api`, which `npm run build` runs, because Vercel runs
// these files as native ES modules and src/ uses extensionless and JSON imports that only a
// bundler resolves.
// ANTHROPIC_API_KEY and AI_BRIEF_MODEL come from the Vercel project's environment variables and
// never reach the browser.
import { clientIpFrom, handleAiBriefRequest } from './_lib/ai-brief-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleAiBriefRequest(request, {
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AI_BRIEF_MODEL: process.env.AI_BRIEF_MODEL },
      clientIp: clientIpFrom(request.headers),
    });
  },
};
