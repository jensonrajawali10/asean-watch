// Types for the generated bundle api/_lib/watch-core.js (source: src/lib/watchProxy.ts).
// Keep in step with that file's exports.
export interface WatchContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleWatchRequest(request: Request, ctx: WatchContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
