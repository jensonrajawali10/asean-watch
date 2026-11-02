// Types for the generated bundle api/_lib/thaiwater-core.js (source: src/lib/thaiwaterProxy.ts).
// Keep in step with that file's exports.
export interface ThaiWaterContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleThaiWaterRequest(request: Request, ctx: ThaiWaterContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
