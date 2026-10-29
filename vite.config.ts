import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

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
    relayDevApi('/api/dsda', '/src/lib/dsdaProxy.ts', 'handleDsdaRequest'),
    relayDevApi('/api/open-meteo', '/src/lib/openMeteoProxy.ts', 'handleOpenMeteoRequest'),
    relayDevApi('/api/sg', '/src/lib/sgProxy.ts', 'handleSgRequest'),
    relayDevApi('/api/ptwc', '/src/server/ptwcHandler.ts', 'handlePtwcRequest'),
    relayDevApi('/api/fires', '/src/lib/firesProxy.ts', 'handleFiresRequest'),
    relayDevApi('/api/watch', '/src/lib/watchProxy.ts', 'handleWatchRequest'),
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
