import fs from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'

// The job belongs to the shared queue, including cancellation and the Host activity lease.
export function createTranscriber(tasks) {
  return {
    async read(file, signal) {
      const job = await tasks.startTask({ mode: 'transcribe', path: file }, 'ui', signal)
      try {
        for (;;) {
          signal.throwIfAborted()
          const task = await tasks.getTask(job.id)
          if (task.status === 'succeeded') {
            const artifact = task.artifacts.find(item => item.kind === 'transcript')
            const { segments: cues } = JSON.parse(await fs.readFile(artifact.path, 'utf8'))
            if (!cues.length) throw new Error('录音中未识别到讲话')
            return { cues, text: cues.map(part => part.text).join(' ') }
          }
          if (!['queued', 'running'].includes(task.status)) throw new Error(task.message)
          await wait(500, undefined, { signal })
        }
      } finally {
        if (signal.aborted) await tasks.cancelTask(job.id)
      }
    },
  }
}
