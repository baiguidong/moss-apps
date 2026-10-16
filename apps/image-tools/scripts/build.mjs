import { buildApp } from '@moss/local-tasks/build'
import { fileURLToPath } from 'node:url'
buildApp(fileURLToPath(new URL('..', import.meta.url)), ["sharp"])
