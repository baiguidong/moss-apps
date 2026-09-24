import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The test mounts Core's actual container and styles. No fixture UI ships in the App ZIP.
export async function buildEmbeddedShell(core, outputDir) {
  const requireCore = createRequire(join(core, 'ui/package.json'))
  const tailwind = requireCore('@tailwindcss/postcss')
  const styles = join(dirname(outputDir), 'shell-style.css')
  await mkdir(dirname(outputDir), { recursive: true })
  await writeFile(styles, [
    `@import ${JSON.stringify(join(core, 'ui/src/renderer-react/globals.css'))};`,
    `@source ${JSON.stringify(join(core, 'ui/src/renderer-react/components/embedded-app-view.tsx'))};`,
    `@source ${JSON.stringify(join(core, 'ui/src/renderer-react/components/ui/button.tsx'))};`,
  ].join('\n'))
  await build({
    configFile: false, root: fileURLToPath(new URL('embedded-shell/', import.meta.url)), base: './',
    plugins: [react()], logLevel: 'warn',
    resolve: { dedupe: ['react', 'react-dom'], alias: {
      '@': join(core, 'ui/src/renderer-react'),
      'moss-core-embedded-view': join(core, 'ui/src/renderer-react/components/embedded-app-view.tsx'),
      'moss-core-global-style': styles,
    } },
    css: { postcss: { plugins: [tailwind()] } },
    build: { outDir: outputDir, emptyOutDir: true },
  })
  return join(outputDir, 'index.html')
}
