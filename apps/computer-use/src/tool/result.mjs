import { isDeepStrictEqual } from 'node:util';
function duplicatesState(text, state) {
  if (typeof state.tree_markdown === 'string' && text.trim() === state.tree_markdown.trim()) return true
  try {
    const parsed = JSON.parse(text)
    const { moss, ...driverState } = state
    return isDeepStrictEqual(parsed, state) || isDeepStrictEqual(parsed, driverState)
  } catch { return false }
}

export function normalizeResult(data) {
  const state = data.structuredContent;
  const content = [];
  if (state) {
    const { tree_markdown, ...structured } = state;
    const hasElements = Array.isArray(state.elements) && state.elements.length > 0;
    content.push({ type: 'text', text: JSON.stringify(hasElements ? structured : state) });
  }
  for (const item of data.content || []) {
    if (item.type === 'image' || !state || data.isError || !duplicatesState(item.text, state)) content.push(item);
  }
  return { format: 'moss.tool-result/v1', content, ...(data.isError ? { isError: true } : {}) };
}
