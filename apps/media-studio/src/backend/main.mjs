import { startBackend } from '@moss/engine-apps/backend'
import { openLocalTasks, registerLocalActions } from '@moss/local-tasks/backend'
import { fileURLToPath } from 'node:url'
import engine from './workshop-engine.mjs'
import { registerWorkshop } from './workshop.mjs'
import { inspect, validate } from './image/engine.mjs'
import { previewImage } from './image/preview.mjs'
import { ensureBinary } from '@moss/engine-apps/runtime'
import ffmpeg from '../../resources/engine.json' with { type: 'json' }
import ffprobe from '../../resources/ffprobe.json' with { type: 'json' }

let registration, image
startBackend({
  ...engine,
  register(backend, context, tasks) {
    return registration ??= (async () => {
      backend.registerAction('video.runtime', async (_input, action) => {
        if (action.source?.callerAppId !== 'moss.backup') throw new Error('视频引擎供文件管理调用')
        const [ffmpegPath, ffprobePath] = await Promise.all(
          [ffmpeg, ffprobe].map(spec => ensureBinary(spec, context.dataDir, action.signal)),
        )
        return { ffmpeg: ffmpegPath, ffprobe: ffprobePath }
      })
      const images = () => image ??= openLocalTasks(backend, context, {
        directory: 'images', event: 'image.workspace.changed', worker: fileURLToPath(new URL('./image-worker.mjs', import.meta.url)), inspect, validate,
      }).catch(error => { image = undefined; throw error })
      registerLocalActions(backend, images, {
        prefix: 'image.',
        extraActions: {
          'tasks.retry': (service, { id }, ctx) => {
            const task = service.state.tasks.find(item => item.id === id)
            if (!task) throw new Error('找不到图片任务')
            if (['queued', 'running', 'canceling'].includes(task.status)) throw new Error('该任务仍在处理中')
            return service.start(task.input, ctx.signal)
          },
          'files.preview': (service, input) => previewImage(service, input.id),
          'tasks.list': ({ state }) => {
            const files = new Map(state.files.map(file => [file.id, file]))
            return { tasks: state.tasks.map(({ id, title, status, progress, message, createdAt, input, outputs }) => ({
              id, title, status, progress, message, createdAt,
              fileNames: (Array.isArray(input.fileIds) ? input.fileIds : []).map(id => files.get(id)?.name).filter(Boolean),
              results: outputs.map(id => files.get(id)).filter(Boolean)
                .map(({ id, name, size }) => ({ id, name, size })),
            })) }
          },
        },
      })
      return registerWorkshop(backend, context, tasks, images)
    })()
  },
  async close() { await Promise.all([(await registration)?.(), (await image)?.close()]) },
}, fileURLToPath(new URL('worker.mjs', import.meta.url)))
