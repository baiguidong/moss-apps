import { startWorker } from '@moss/local-tasks/worker'
import { execute } from './engine.mjs'
startWorker(execute)
