import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/gate-b': { target: 'http://127.0.0.1:4231', changeOrigin: true },
      '/graphql': { target: 'http://127.0.0.1:4010', changeOrigin: true, rewrite: () => '/'  },
      // The Rosina service (src/rosina/server.ts, `npm run rosina`). Port from ROSINA_PORT, default 4200.
      '/api/orbit': { target: 'http://127.0.0.1:4008', changeOrigin: true },
      '/api/village': { target: 'http://127.0.0.1:4008', changeOrigin: true },
      '/api/demo': { target: 'http://127.0.0.1:4008', changeOrigin: true },
      '/api/rosina': { target: 'http://127.0.0.1:4200', changeOrigin: true },
      // Browser voice (#71 voice-turn server, VOICE_PORT default 4118). Same-origin so the
      // caller's bearer is forwarded exactly like a Rosina text turn; keys stay server-side.
      // Trailing slash so it matches /voice/turn + /voice/transcribe, never /voice-turn.
      '/voice/': { target: 'http://127.0.0.1:4118', changeOrigin: true },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
