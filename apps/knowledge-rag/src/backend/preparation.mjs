export const PREPARATION_STEPS = [
  ['environment', '运行环境'], ['dependencies', '引擎依赖'], ['model', '多语言模型'],
  ['service', '本地服务'], ['index', '恢复索引'], ['connect', '连接 Moss'],
]

// Keep diagnostics bounded and safe to display (pip may print authenticated URLs).
export function cleanOutput(value) {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s]+/g, value => {
      try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '[下载地址]' }
    }).replace(/Bearer\s+\S+/gi, 'Bearer [hidden]').trim().slice(-1200)
}

export class Preparation {
  constructor(install, changed, now = Date.now) {
    this.now = now; this.changed = changed
    this.startedAt = this.updatedAt = now()
    this.steps = PREPARATION_STEPS.map(([id, label], index) => ({ id, label, state: !install && index < 2 ? 'cached' : 'pending' }))
    this.logs = []; this.detail = ''; this.stage = null; this.download = null
  }
  step(id, detail) {
    if (this.endedAt) return
    const previous = this.steps.find(step => step.id === this.stage)
    if (previous) previous.state = 'done'
    this.stage = id; this.stageStartedAt = this.updatedAt = this.now(); this.download = null
    this.steps.find(step => step.id === id).state = 'active'
    this.detail = detail; this.changed()
  }
  output(line) {
    if (this.endedAt) return
    if (line.startsWith('MOSS_PROGRESS ')) {
      try {
        const value = JSON.parse(line.slice(14))
        this.detail = cleanOutput(value.detail || this.detail)
        this.download = Number.isFinite(value.completed) && Number.isFinite(value.total) && value.total > 0
          ? { completed: Math.max(0, Math.min(value.completed, value.total)), total: value.total, file: cleanOutput(value.file || '') }
          : null
      } catch { return }
    } else {
      const text = cleanOutput(line)
      if (!text) return
      this.logs.push(text); this.logs = this.logs.slice(-24)
    }
    this.updatedAt = this.now(); this.changed()
  }
  finish(result) {
    if (this.endedAt) return
    this.endedAt = this.now()
    const step = this.steps.find(step => step.id === this.stage)
    if (step) step.state = result
    this.changed()
  }
  snapshot() {
    const now = this.endedAt || this.now()
    return { steps: this.steps.map(step => ({ ...step })), stage: this.stage, detail: this.detail,
      observedAt: this.now(), startedAt: this.startedAt, elapsedMs: now - this.startedAt, stageElapsedMs: now - (this.stageStartedAt || this.startedAt),
      idleMs: now - this.updatedAt, download: this.download, logs: [...this.logs] }
  }
}

// stdout/stderr arrive in arbitrary chunks; preserve both split UTF-8 and CR progress lines.
export function lineCollector(consume) {
  let pending = ''
  return {
    write(chunk) {
      const lines = (pending + chunk).split(/[\r\n]+/)
      pending = lines.pop().slice(-16000)
      for (const line of lines) if (line) consume(line)
    },
    end() { if (pending) consume(pending); pending = '' },
  }
}
