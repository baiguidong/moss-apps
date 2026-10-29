import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStore } from '@moss/engine-apps/runtime'
export function composerActions(dataDir) {
  const store = new TaskStore(dataDir)
  return {
    async list({ query = '', offset = 0, limit = 20 } = {}) {
      return { items: (await store.list()).filter(task => task.status === 'succeeded' && (task.input.title || '').toLowerCase().includes(query.toLowerCase()))
        .slice(offset, offset + Math.min(limit, 20)).map(task => ({ title: task.input.title, description: '继续修改这份可视化作品', ref: { taskId: task.id }, scope: 'user' })) }
    },
    async resolve(input) {
      if (input?.uri) {
        const uri = new URL(input.uri)
        if (uri.protocol !== 'moss-visualize:' || uri.hostname !== 'works' || uri.search || uri.hash || !/^\/[a-zA-Z0-9_-]{1,100}$/.test(uri.pathname)) throw new Error('作品引用无效')
        const task = await store.get(uri.pathname.slice(1))
        if (task.status !== 'succeeded') throw new Error('作品尚未生成')
        const file = task.artifacts.find(item => item.kind === 'html')
        if (!file) throw new Error('找不到交互作品')
        const target = await fs.realpath(file.path), root = await fs.realpath(store.directory(task.id))
        if (path.dirname(target) !== root) throw new Error('作品文件不属于当前任务')
        return { kind: 'file', name: task.input.title + '.html', path: target, resourceUri: input.uri,
          presentation:{type:'interactive-html'}, version:task.result?.version||1, workId:task.result?.workId||task.id }
      }
      if (!['create','edit','use'].includes(input?.intent)) throw new Error('请选择创作或继续修改作品')
      const ref = input.ref || {}, prompt = ref.prompt || ''
      if (typeof prompt !== 'string' || prompt.length > 3500) throw new Error('需求最多支持 3500 字')
      if (ref.taskId && (typeof ref.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(ref.taskId))) throw new Error('作品 ID 无效')
      const task = ref.taskId ? await store.get(ref.taskId) : null
      if (input.intent !== 'create' && (!task || task.status !== 'succeeded')) throw new Error('作品尚未生成，请先创作')
      return {
        title: task?.input.title || '可视化创作', ref,
        prompt: `${task ? `请继续修改可视化作品「${task.input.title}」。` : '请使用可视化 App 创作交互作品。'}\n${prompt || '请先了解我希望说明的问题，再生成适合的作品。'}`,
        tools: ['visualize_create','visualize_status'],
        instruction: `用户通过可视化 App 发起创作。读取当前 App 提供的 SKILL.md。由 AI 根据自然语言需求选择图表或编写自包含的交互 HTML，再用 visualize_create 保存。不要要求用户编写 HTML 或 CSV；如果需要数据，询问具体内容或使用用户提供的材料。${task ? `先用 visualize_status 读取 taskId=${task.id} 的 input，保留现有内容，传 parentId 创建新的版本。` : ''}保存后查询任务成功状态，使用 moss_present(result.presentation) 在右侧展示；在最终回复使用任务 result.displayMarkdown，让交互作品直接出现在主会话消息中。不要要求用户打开 App 查看。把 HTML 作为实现材料，不把源码直接交给用户代替作品。数据不足时澄清，不捏造真实数据。`,
      }
    },
  }
}
