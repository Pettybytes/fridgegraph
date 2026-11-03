import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Standalone, offline fixture bundle for local preview, embedding and capture.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: 'story-replay-export', emptyOutDir: true, rollupOptions: { input: path.resolve(import.meta.dirname, 'story-replay-preview.html') } },
})
