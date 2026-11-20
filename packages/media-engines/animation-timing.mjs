import { createRequire } from 'node:module'

// Use the CSS parser already shipped with the HyperFrames runtime.
const require = createRequire(import.meta.url)
const { parse, walk, generate } = createRequire(require.resolve('hyperframes/package.json'))('css-tree')

export function animationTimingWarnings(html, scene) {
  const warnings = []
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => [match[1], 'stylesheet'])
  for (const match of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) blocks.push([match[1] ?? match[2], 'declarationList'])
  for (const [css, context] of blocks) {
    let ast
    try { ast = parse(css, { context }) } catch { continue }
    walk(ast, { visit: 'Declaration', enter(node) {
      const property = node.property.toLowerCase().replace(/^-webkit-/, '')
      if (!['animation', 'animation-delay'].includes(property) || node.value.type !== 'Value') return
      const groups = [[]]
      for (const token of node.value.children) {
        if (token.type === 'Operator' && token.value === ',') groups.push([])
        else groups.at(-1).push(token)
      }
      for (const group of groups) {
        // Dynamic values and cascade overrides require visual inspection. Do
        // not guess their timing or rewrite CSS; report literal delays only.
        if (group.some(token => token.type === 'Function' && ['var', 'calc', 'min', 'max', 'clamp'].includes(token.name.toLowerCase()))) continue
        const times = group.filter(token => token.type === 'Dimension' && /^(ms|s)$/i.test(token.unit))
        const delay = times[property === 'animation' ? 1 : 0]
        if (!delay) continue
        const seconds = Number(delay.value) / (delay.unit.toLowerCase() === 'ms' ? 1000 : 1)
        if (seconds < scene.duration) continue
        warnings.push({ code: 'ANIMATION_DELAY_OUTSIDE_SCENE', sceneId: scene.id,
          delay: seconds, duration: scene.duration, declaration: generate(node),
          message: `分镜 ${scene.id} 的动画延迟 ${seconds} 秒不小于镜头时长 ${scene.duration} 秒，可能整段不可见。场景内动画从本镜头的 0 秒计时，不要累加前序镜头时长。` })
      }
    } })
  }
  return warnings
}

export function projectTimingWarnings(project) {
  return (project.storyboard?.scenes ?? []).flatMap(scene => animationTimingWarnings(project.scenes.find(saved => saved.id === scene.id)?.html ?? '', scene))
}
