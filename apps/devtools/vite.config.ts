import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/ui', emptyOutDir: true },
})
