import { SERVICE, DEFAULT_SETTINGS, type Catalog, type Input, type Method } from '../contracts'
const tools = [["git_status", "查看仓库工作区状态。"], ["git_diff_unstaged", "查看未暂存的改动。"], ["git_diff_staged", "查看已暂存的改动。"], ["git_diff", "比较工作区与分支或提交。"], ["git_commit", "提交暂存区改动。"], ["git_add", "暂存仓库中的文件。"], ["git_reset", "取消全部暂存。"], ["git_log", "查询提交历史。"], ["git_create_branch", "创建分支。"], ["git_checkout", "切换分支。"], ["git_show", "查看提交内容。"], ["git_branch", "列出分支。"]]
const catalog: Catalog = { settings: structuredClone(DEFAULT_SETTINGS), preparation: { state: 'ready' }, servers: [] }
export async function demoRequest(method: Method, input: Input): Promise<Catalog> {
  await new Promise(resolve => setTimeout(resolve, 100))
  if (method === 'servers.save') catalog.settings = { ...catalog.settings, ...structuredClone(input) }
  catalog.preparation = { state: 'ready' }
  catalog.servers = [{ name: SERVICE, enabled: true, updatedAt: Date.now(), credentialsMissing: false,
    config: { type: 'stdio', disabledTools: catalog.settings.disabledTools },
    check: { state: 'connected', checkedAt: Date.now(), tools: tools.map(([name, description]) => ({ name, description, disabled: catalog.settings.disabledTools.includes(name) })) } }]
  return structuredClone(catalog)
}
