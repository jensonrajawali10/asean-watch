import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** The part of src/server/aiBriefHandler.ts the dev middleware calls (loaded through Vite SSR). */
interface AiBriefModule {
  handleAiBriefRequest(
    request: Request,
    ctx: { env: { ANTHROPIC_API_KEY?: string; AI_BRIEF_MODEL?: string }; clientIp: string },
  ): Promise<Response>
}

/**
 * Dev-only env: .env.local only (gitignored by *.local), read from the file. The shell environment is
 * deliberately ignored so a key exported for other tools is never used by accident.
 */
function readDevEnv(root: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const name of ['.env.local']) {
    const file = join(root, name)
    if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')))
  }
  return env
}

/**
 * Local dev only: mounts the same handler as the Vercel Function api/ai-brief.ts at /api/ai-brief.
 * The key is read from .env.local (gitignored via *.local) on each request and is never logged.
 */
function aiBriefDevApi(): Plugin {
  return {
    name: 'asean-watch:ai-brief-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/ai-brief', (req, res) => {
        void (async () => {
          try {
            const env = readDevEnv(server.config.root)
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of req) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
              size += buf.length
              if (size > 64 * 1024) break // the handler rejects anything over 1 KB anyway
              chunks.push(buf)
            }
            const headers = new Headers()
            for (const [name, value] of Object.entries(req.headers)) {
              if (Array.isArray(value)) value.forEach((v) => headers.append(name, v))
              else if (value !== undefined) headers.set(name, value)
            }
            const method = req.method ?? 'GET'
            const request = new Request(new URL(req.originalUrl ?? '/api/ai-brief', `http://${req.headers.host ?? 'localhost'}`), {
              method,
              headers,
              body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
            })
            const mod = (await server.ssrLoadModule('/src/server/aiBriefHandler.ts')) as AiBriefModule
            const response = await mod.handleAiBriefRequest(request, {
              env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, AI_BRIEF_MODEL: env.AI_BRIEF_MODEL },
              clientIp: req.socket.remoteAddress ?? 'local',
            })
            res.statusCode = response.status
            response.headers.forEach((value, name) => res.setHeader(name, value))
            res.end(Buffer.from(await response.arrayBuffer()))
          } catch (err) {
            server.config.logger.error(`ai-brief dev middleware: ${err instanceof Error ? err.message : String(err)}`)
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'internal_error' }))
          }
        })()
      })
    },
  }
}

/** A GET relay handler as exported by src/lib/*Proxy.ts (loaded through Vite SSR). */
type RelayHandler = (request: Request, ctx: { clientIp: string }) => Promise<Response>

/**
 * Local dev only: mounts a same-origin GET relay (the same handler as its Vercel Function in api/) so
 * `vite dev` reads the same relayed feeds as production instead of falling back to the snapshots.
 */
function relayDevApi(path: string, modulePath: string, exportName: string): Plugin {
  return {
    name: `asean-watch:relay-dev-api:${path}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(path, (req, res) => {
        void (async () => {
          try {
            const headers = new Headers()
            for (const [name, value] of Object.entries(req.headers)) {
              if (Array.isArray(value)) value.forEach((v) => headers.append(name, v))
              else if (value !== undefined) headers.set(name, value)
            }
            const request = new Request(new URL(req.originalUrl ?? path, `http://${req.headers.host ?? 'localhost'}`), {
              method: req.method ?? 'GET',
              headers,
            })
            const mod = (await server.ssrLoadModule(modulePath)) as Record<string, RelayHandler>
            const response = await mod[exportName](request, { clientIp: req.socket.remoteAddress ?? 'local' })
            res.statusCode = response.status
            response.headers.forEach((value, name) => res.setHeader(name, value))
            res.end(Buffer.from(await response.arrayBuffer()))
          } catch (err) {
            server.config.logger.error(`${path} dev middleware: ${err instanceof Error ? err.message : String(err)}`)
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'internal_error' }))
          }
        })()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    aiBriefDevApi(),
    relayDevApi('/api/dsda', '/src/lib/dsdaProxy.ts', 'handleDsdaRequest'),
    relayDevApi('/api/open-meteo', '/src/lib/openMeteoProxy.ts', 'handleOpenMeteoRequest'),
    relayDevApi('/api/sg', '/src/lib/sgProxy.ts', 'handleSgRequest'),
    relayDevApi('/api/ptwc', '/src/server/ptwcHandler.ts', 'handlePtwcRequest'),
  ],
  // Bundled geometry and real-data snapshots are intentional: the app must work offline.
  build: {
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        // Vendor libraries in their own chunks: they download and compile in parallel with the app, and
        // keep their content hash when only the app or a data snapshot changes (returning visitors).
        // The preload helper gets its own group so index.html does not modulepreload a vendor chunk
        // just because the helper landed in it.
        codeSplitting: {
          groups: [
            { name: 'vite-helpers', test: /preload-helper/, priority: 40 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            {
              name: 'vendor-deck',
              test: /node_modules[\\/](@deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl|@probe\.gl|mjolnir\.js|earcut|@mapbox)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
