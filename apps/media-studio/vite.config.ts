import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createAvatar } from './scripts/avatar.mjs'

function studioAvatar(): Plugin {
  let bytes: Promise<Uint8Array> | undefined
  const asset = () => (bytes ??= createAvatar())
  return {
    name: 'studio-avatar',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'avatar.glb', source: await asset() })
    },
    configureServer(server) {
      server.middlewares.use('/avatar.glb', async (_req, res) => {
        res.setHeader('Content-Type', 'model/gltf-binary')
        res.end(await asset())
      })
    },
  }
}
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react(), studioAvatar()],
  build: { outDir: '../dist/ui', emptyOutDir: true, assetsInlineLimit: 0 },
})
