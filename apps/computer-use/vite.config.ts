import { appSettingsPlugin } from '@moss/app-settings/build'
import { defineConfig } from 'vite'
export default defineConfig({
  plugins: [appSettingsPlugin(new URL('.', import.meta.url))], base: './', build: { outDir: 'dist/ui', emptyOutDir: false } })
