import { startApp } from '@moss/local-tasks/backend'
import { fileURLToPath } from 'node:url'
import { inspect, validate } from './engine.mjs'
startApp({ worker: fileURLToPath(new URL('./worker.mjs', import.meta.url)), inspect, validate })
