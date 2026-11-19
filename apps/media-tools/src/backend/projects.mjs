import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const builtin = { id: 'moss', name: '小墨', builtIn: true }
export const visemes = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH']
export function validateAvatar(buffer) {
  if (
    buffer.length < 24 ||
    buffer.toString('ascii', 0, 4) !== 'glTF' ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length ||
    buffer.toString('ascii', 16, 20) !== 'JSON'
  )
    throw new Error('请选择完整的 GLB 2.0 角色')
  const length = buffer.readUInt32LE(12)
  if (length > buffer.length - 20 || length > 16 * 1024 * 1024) throw new Error('GLB 描述无效')
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + length))
  if (
    [...(gltf.buffers || []), ...(gltf.images || [])].some(
      (item) => item.uri && !item.uri.startsWith('data:'),
    )
  )
    throw new Error('请把纹理和缓冲区嵌入口播 GLB 后再导入')
  if (
    gltf.extensionsRequired?.some((ext) => ['KHR_draco_mesh_compression', 'KHR_texture_basisu'].includes(ext))
  )
    throw new Error('请导出未使用 Draco 或 KTX2 的 GLB')
  const joints = new Set(gltf.nodes?.map((n) => String(n.name || '').replaceAll('mixamorig', '')))
  const bones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
  for (const side of ['Left', 'Right']) {
    for (const limb of ['Eye', 'Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'])
      bones.push(side + limb)
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
      for (let i = 1; i <= 3; i++) bones.push(side + 'Hand' + finger + i)
  }
  const missing = bones.filter((b) => !joints.has(b))
  if (missing.length) throw new Error('角色缺少 TalkingHead 骨骼：' + missing.slice(0, 5).join('、'))
  const targets = new Set(
    (gltf.meshes || []).flatMap((m) =>
      m.primitives?.some((p) => p.targets?.length) ? m.extras?.targetNames || [] : [],
    ),
  )
  const absent = visemes.filter((v) => !targets.has('viseme_' + v))
  if (absent.length) throw new Error('角色缺少口型：' + absent.join('、'))
}
export function serialQueue() {
  let last = Promise.resolve()
  return (fn) => {
    const next = last.then(fn)
    last = next.catch(() => {})
    return next
  }
}
export async function saveJson(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 })
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
export function validId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
    throw new Error('标识无效')
  return id
}
export function projectView(p) {
  return {
    ...p,
    resourceUri: 'moss-studio://projects/' + p.id,
    estimatedSeconds:
      p.source === 'script' ? Math.ceil((p.script.replace(/\s/g, '').length * 60) / p.rate) : undefined,
    presentation: { title: p.name, route: '#/projects/' + p.id },
  }
}
export function createProjectStore(root) {
  const serial = serialQueue()
  const indexFile = path.join(root, 'library.json')
  const file = (id) => path.join(root, 'projects', validId(id) + '.json')
  const get = (id) => readJson(file(id))
  const library = () => readJson(indexFile)
  const defaults = {
    name: '未命名口播',
    script: '',
    source: 'script',
    audioId: '',
    transcriptId: '',
    voice: 'Tingting',
    rate: 200,
    aspect: '16:9',
    camera: 'upper',
    background: '#cadbd7',
    subtitles: true,
    quality: '720p',
  }
  function validate(fields, lib) {
    if (Object.keys(fields).some((k) => !(k in defaults) && k !== 'avatarId')) throw new Error('未知项目设置')
    if (
      typeof fields.script !== 'string' ||
      fields.script.length > 6000 ||
      typeof fields.name !== 'string' ||
      !fields.name.trim() ||
      fields.name.length > 100
    )
      throw new Error('请输入项目名称，讲稿最多 6000 字')
    if (
      !lib.avatars.some((a) => a.id === fields.avatarId) ||
      (fields.audioId && !lib.audio.some((a) => a.id === fields.audioId))
    )
      throw new Error('素材不存在')
    if (fields.transcriptId && lib.transcripts?.[fields.transcriptId] !== fields.audioId)
      throw new Error('字幕与配音不匹配')
    if (
      !['script', 'audio'].includes(fields.source) ||
      !['16:9', '9:16'].includes(fields.aspect) ||
      !['head', 'upper', 'full'].includes(fields.camera) ||
      !['720p', '480p'].includes(fields.quality)
    )
      throw new Error('口播设置无效')
    if (
      !Number.isInteger(fields.rate) ||
      fields.rate < 100 ||
      fields.rate > 350 ||
      typeof fields.voice !== 'string' ||
      !fields.voice.trim() ||
      fields.voice.length > 100 ||
      !/^#[a-fA-F0-9]{6}$/.test(fields.background) ||
      typeof fields.subtitles !== 'boolean'
    )
      throw new Error('配音、字幕或背景设置无效')
    return fields
  }
  async function create(fields = {}) {
    const lib = await library(),
      id = randomUUID()
    const project = {
      ...validate({ ...defaults, avatarId: lib.defaultAvatar, ...fields }, lib),
      id,
      version: 1,
      updatedAt: Date.now(),
    }
    await saveJson(file(id), project)
    return project
  }
  return {
    get,
    library,
    create: (fields) => serial(() => create(fields)),
    file,
    async init() {
      await Promise.all(
        ['projects', 'assets', 'speech', 'chat'].map((d) =>
          fs.mkdir(path.join(root, d), { recursive: true, mode: 0o700 }),
        ),
      )
      try {
        await library()
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
        await saveJson(indexFile, { avatars: [builtin], defaultAvatar: builtin.id, audio: [] })
      }
    },
    async list() {
      return (
        await Promise.all(
          (await fs.readdir(path.join(root, 'projects')))
            .filter((n) => n.endsWith('.json'))
            .map((n) => get(n.slice(0, -5))),
        )
      ).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    save: ({ id, version, fields }) =>
      serial(async () => {
        const project = await get(id)
        if (project.version !== version) throw new Error('项目已在其他窗口更新，请重新载入后再保存')
        const { id: unused, version: old, updatedAt, ...existing } = project
        const changed = {
          ...validate({ ...existing, ...fields }, await library()),
          id,
          version: old + 1,
          updatedAt: Date.now(),
        }
        await saveJson(file(id), changed)
        return changed
      }),
    editLibrary: (edit) =>
      serial(async () => {
        const lib = await library()
        await edit(lib)
        await saveJson(indexFile, lib)
        return lib
      }),
  }
}
