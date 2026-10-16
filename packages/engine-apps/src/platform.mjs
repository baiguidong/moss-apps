/** Select a pinned asset for the executing Host; never fall back across OS/CPU. */
export function platformAsset(spec, platform = `${process.platform}-${process.arch}`) {
  const { targets, ...base } = spec
  if (base.platform === platform) return base
  const target = targets?.[platform]
  if (!target) throw new Error(`当前发行版不支持 ${platform}`)
  return { ...base, ...target, platform }
}
