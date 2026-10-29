// Types for the generated bundle api/_lib/vaac-core.js (source: src/lib/vaacProxy.ts).
// Keep in step with that file's exports.
export interface VaacContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleVaacRequest(request: Request, ctx: VaacContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
