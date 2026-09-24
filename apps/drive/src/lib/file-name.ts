export function folderNameError(name: string): string | null {
  if (!name.trim()) return '请输入目录名称。'
  if (name === '.' || name === '..' || /[\x00-\x1f\x7f/\\]/u.test(name)) return '名称不能包含斜杠、控制字符，也不能使用“.”或“..”。'
  if (new TextEncoder().encode(name).length > 255) return '目录名称过长，请缩短后重试。'
  return null
}
