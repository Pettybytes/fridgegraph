import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/graphql': { target: 'http://127.0.0.1:4010', changeOrigin: true },
      // The Rosina service (src/rosina/server.ts, `npm run rosina`). Port from ROSINA_PORT, default 4200.
      '/api/rosina': { target: 'http://127.0.0.1:4200', changeOrigin: true },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
