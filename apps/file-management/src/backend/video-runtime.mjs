import path from 'node:path'
import { APP_ERROR_CODES, createAppCapabilitiesClient } from '@moss/app-sdk'
import { assetHash } from '@moss/engine-apps/bundled'
import hashes from '../../resources/video-runtime.json' with { type: 'json' }

export const videoAppId = 'moss.media-studio'
const protocol = 'moss.media-runtime/v1'
const installMessage = `请安装多媒体工坊（${videoAppId}）以使用相似视频和视频优化。已安装旧版本时请升级到 0.1.1 或兼容版本。`
export const usesVideo = input => ['video', 'video-optimizer'].includes(input?.command)

export async function videoProvider(host, signal) {
  const capabilities = createAppCapabilitiesClient(host)
  try {
    const { providers } = await capabilities.list({ protocol }, { signal, timeoutMs: 10_000 })
    const candidates = providers.filter(provider => provider.appId === videoAppId)
    const provider = candidates.find(item => item.status === 'available' && item.methods.includes('video.get'))
    if (provider) return { ref: provider.providerRef, capabilities, message: '' }
    const message = candidates.some(item => ['disabled', 'instance_disabled'].includes(item.status))
      ? `请启用多媒体工坊（${videoAppId}）以使用视频功能。`
      : candidates.length ? `请检查多媒体工坊（${videoAppId}）的视频引擎授权和运行状态。` : installMessage
    return { message }
  } catch (error) {
    signal?.throwIfAborted()
    return { message: error.code === APP_ERROR_CODES.permissionDenied
      ? '请在文件管理的 App 权限中允许调用其他 App。'
      : `暂时无法查询多媒体工坊（${videoAppId}），请重试。` }
  }
}

export async function requireVideoProvider(host, signal) {
  const provider = await videoProvider(host, signal)
  if (!provider.ref) throw new Error(provider.message)
  return provider
}

export async function videoWorkerEnv(host, signal) {
  const { ref, capabilities } = await requireVideoProvider(host, signal)
  const binaries = await capabilities.invoke(ref, 'video.get', {}, { signal, timeoutMs: 120_000 })
  const pinned = hashes[`${process.platform}-${process.arch}`]
  try {
    await Promise.all(['ffmpeg', 'ffprobe'].map(async name => {
      const file = binaries?.[name]
      if (typeof file !== 'string' || !path.isAbsolute(file) || path.basename(file) !== name
        || path.dirname(file).includes(path.delimiter) || await assetHash(file) !== pinned?.[name]) {
        throw new Error('Invalid media binary')
      }
    }))
  } catch {
    signal?.throwIfAborted()
    throw new Error(`请更新或重新安装多媒体工坊（${videoAppId}），其视频引擎版本或校验值不匹配。`)
  }
  signal?.throwIfAborted()
  return { MOSS_VIDEO_FFMPEG: binaries.ffmpeg, MOSS_VIDEO_FFPROBE: binaries.ffprobe }
}
