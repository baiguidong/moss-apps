import { buildApp } from '@moss/engine-apps/build'
import { fileURLToPath } from 'node:url'
await buildApp(fileURLToPath(new URL('..', import.meta.url)))
