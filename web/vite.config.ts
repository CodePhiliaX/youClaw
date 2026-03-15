import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // SSE 代理插件：绕过 Vite 默认 proxy 的响应缓冲
    {
      name: 'sse-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/stream/')) return next()

          // 直接 pipe 到后端，不经过 http-proxy 的缓冲
          const proxyReq = http.request(
            `http://localhost:23107${req.url}`,
            { method: 'GET', headers: { ...req.headers, host: 'localhost:23107' } },
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
        target: 'http://localhost:23107',
        changeOrigin: true,
      },
    },
  },
})
