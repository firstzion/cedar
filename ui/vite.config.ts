import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Haxall has no CORS support, so in development the browser talks to this dev server
// and Vite forwards /api calls to Haxall (same origin from the browser's point of view).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '') // reads the repo-root .env
  const haxall = env.HAXALL_URL || `http://localhost:${env.HAXALL_PORT || '8080'}`
  return {
    plugins: [react()],
    // the Trend Viewer chunk holds the chart library (about 590 kB), which is fine for a local tool
    build: { chunkSizeWarningLimit: 700 },
    server: { port: 5173, proxy: { '/api': { target: haxall, changeOrigin: true } } },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: false },
  }
})
