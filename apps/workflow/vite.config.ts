import { appSettingsPlugin } from '@moss/app-settings/build'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)), base: './', plugins: [appSettingsPlugin(new URL('.', import.meta.url)), react(), tailwind()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../dist/ui', emptyOutDir: true },
})
