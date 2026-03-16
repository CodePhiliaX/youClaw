import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

const BACKEND_PORT = process.env.PORT || '62601'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // SSE proxy plugin: bypass Vite default proxy response buffering
    {
      name: 'sse-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/stream/')) return next()

          // Pipe directly to the backend, bypassing http-proxy buffering
          const proxyReq = http.request(
            `http://localhost:${BACKEND_PORT}${req.url}`,
            { method: 'GET', headers: { ...req.headers, host: `localhost:${BACKEND_PORT}` } },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode ?? 200, {
                ...proxyRes.headers,
                'cache-control': 'no-cache',
                'x-accel-buffering': 'no',
              })
              proxyRes.pipe(res)
            },
          )

          proxyReq.on('error', () => {
            if (!res.headersSent) res.writeHead(502)
            res.end()
          })

          req.on('close', () => proxyReq.destroy())
          proxyReq.end()
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
