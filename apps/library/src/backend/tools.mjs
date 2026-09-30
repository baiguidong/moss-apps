// AI sees a small CRUD interface; the UI keeps its focused management actions.
export function resolveToolAction(name, input = {}) {
  if (name === 'library.list') {
    const { kind = 'collections', collectionId, ...page } = input
    const action = { collections: 'collections.list', sources: 'sources.list', resources: 'documents.list' }[kind]
    if (!action) throw new Error('不支持的列表类型。')
    if (kind === 'collections' && collectionId) throw new Error('列出资料集不需要 collectionId。')
    return { name: action, input: { ...page, ...(collectionId ? kind === 'resources' ? { collectionIds: [collectionId] } : { collectionId } : {}) } }
  }
  if (name === 'library.write') {
    return { name: 'files.import', input, options: { filesOnly: true } }
  }
  throw new Error('不支持的知识库工具。')
}
