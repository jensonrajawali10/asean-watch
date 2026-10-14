// Types for the generated bundle api/_lib/ai-brief-core.js (source: src/server/aiBriefHandler.ts).
// Keep in step with that file's exports.
export interface AiBriefEnv {
  ANTHROPIC_API_KEY?: string;
  AI_BRIEF_MODEL?: string;
}

export interface AiBriefContext {
  env: AiBriefEnv;
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export declare function handleAiBriefRequest(request: Request, ctx: AiBriefContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
