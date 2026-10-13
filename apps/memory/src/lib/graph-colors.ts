const palettes = [
  { stroke: '#608fbc', fill: '#eaf2fb', darkFill: '#253b50' },
  { stroke: '#a383bc', fill: '#f1eaf8', darkFill: '#3d304d' },
  { stroke: '#51a08a', fill: '#e5f3ed', darkFill: '#253f36' },
  { stroke: '#c29459', fill: '#faf0e1', darkFill: '#473b29' },
  { stroke: '#bf7e95', fill: '#faeaf0', darkFill: '#47303b' },
  { stroke: '#848fca', fill: '#eceefa', darkFill: '#30384c' },
]
export function typePalette(type: string) {
  const common = new Map([
    ['项目', 0], ['project', 0], ['偏好', 1], ['preference', 1], ['组织', 2], ['organization', 2],
    ['人物', 3], ['person', 3], ['需求', 4], ['requirement', 4], ['任务', 5], ['task', 5],
  ])
  const known = common.get(type.toLowerCase())
  if (known !== undefined) return palettes[known]
  let hash = 0
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palettes[hash % palettes.length]
}
export const typeColor = (type: string) => typePalette(type).stroke
