export const resourceUri = id => `moss-pdf://files/${id}`
export function versionOf(task, tasks) {
  let current = task, version = 1
  const seen = new Set([task.id])
  while (current.input?.parentId) {
    const parent = tasks.find(t => t.id === current.input.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id); current = parent; version++
  }
  return { workId: current.id, version, parentId: task.input?.parentId || null }
}
export function present(task, files, tasks = []) {
  const outputs = (task.outputs || []).map(id => files.find(f => f.id === id)).filter(Boolean)
  const primary = outputs.find(f => f.kind === 'pdf') || outputs[0]
  const downloads = outputs.map(file => ({ ...file, resourceUri: resourceUri(file.id) }))
  return { ...task, result: primary ? {
    ...versionOf(task, tasks), resourceUri: resourceUri(primary.id), downloads, files: downloads,
    presentation: { items: [{ resource_uri: resourceUri(primary.id), title: task.title || primary.name, role: 'primary' }], mode: 'auto' },
    displayMarkdown: `[${primary.name.replace(/[\[\]]/g, '')}](${resourceUri(primary.id)})`,
  } : null }
}
