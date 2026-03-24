import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

const BACKEND_PORT = process.env.PORT || '62601'
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1'
const BACKEND_ORIGIN = `http://${BACKEND_HOST}:${BACKEND_PORT}`

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    // Tauri uses system WKWebView; macOS 10.15 ships Safari 13
    target: ['es2020', 'safari13'],
  },
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
            `${BACKEND_ORIGIN}${req.url}`,
            { method: 'GET', headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` } },
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
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
    },
  },
})
