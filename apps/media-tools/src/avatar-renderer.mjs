import { TalkingHead } from '@met4citizen/talkinghead'
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs'
import worklet from '@met4citizen/headaudio/dist/headworklet.min.mjs?url'
import visemes from '@met4citizen/headaudio/dist/model-en-mixed.bin?url'

export function frameSize(aspect, quality) {
  const short = quality === '480p' ? 480 : 720,
    long = short === 480 ? 854 : 1280
  return aspect === '9:16' ? [short, long] : [long, short]
}
export function drawCaption(ctx, text, w, h) {
  if (!text) return
  const font = Math.round(Math.min(w, h) * 0.045),
    lines = []
  ctx.font = '600 ' + font + 'px -apple-system, BlinkMacSystemFont, sans-serif'
  for (const letter of text) {
    const last = lines.length - 1
    if (last < 0 || ctx.measureText(lines[last] + letter).width > w * 0.85) lines.push(letter)
    else lines[last] += letter
  }
  const visible = lines.slice(0, 4),
    lineHeight = font * 1.32,
    bottom = h * 0.94
  const width = Math.max(...visible.map((l) => ctx.measureText(l).width)) + font
  ctx.fillStyle = 'rgba(14,26,28,.78)'
  ctx.beginPath()
  ctx.roundRect(
    (w - width) / 2,
    bottom - visible.length * lineHeight - font * 0.25,
    width,
    visible.length * lineHeight + font * 0.42,
    font * 0.32,
  )
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  visible.forEach((line, i) => ctx.fillText(line, w / 2, bottom - (visible.length - 1 - i) * lineHeight))
}
export async function openStage(host, options, signal) {
  const { avatarUrl, camera, background, aspect, quality } = options
  const [w, h] = frameSize(aspect, quality)
  const head = new TalkingHead(host, {
    cameraView: camera,
    // The vertical field of view stays constant as the canvas narrows.
    // Leave room for both shoulders on a portrait talking-head shot.
    ...(aspect === '9:16' && camera !== 'full'
      ? { cameraDistance: camera === 'upper' ? 2.6 : 4.05, cameraY: camera === 'upper' ? 0.58 : 0.65 }
      : {}),
    cameraRotateEnable: false,
    cameraZoomEnable: false,
    cameraPanEnable: false,
    lipsyncModules: [],
    modelPixelRatio: 1 / window.devicePixelRatio,
    modelFPS: 24,
  })
  // TalkingHead animates these channels even on avatars with only Oculus visemes.
  // Register logical channels so absent facial geometry simply stays still.
  head.mtCustoms.push(
    ...head.mtRandomized,
    'eyesLookDown',
    'eyesLookUp',
    'eyesClosed',
    'eyeLookInLeft',
    'eyeLookInRight',
    'eyeLookOutLeft',
    'eyeLookOutRight',
    'eyeBlinkLeft',
    'eyeBlinkRight',
    'browDownLeft',
    'browDownRight',
  )
  const ctx = head.audioCtx
  let mouth,
    closed = false
  function dispose() {
    if (closed) return
    closed = true
    mouth?.stop()
    mouth?.disconnect()
    mouth?.port.close()
    head.dispose()
    if (ctx.state !== 'closed') void ctx.close().catch(() => {})
  }
  try {
    await Promise.all([
      head.showAvatar({ url: avatarUrl, body: 'F', avatarMood: 'neutral' }),
      ctx.audioWorklet.addModule(worklet),
    ])
    signal.throwIfAborted()
    mouth = new HeadAudio(ctx, { parameterData: { vadGateActiveDb: -40, vadGateInactiveDb: -60 } })
    await mouth.loadModel(visemes)
    signal.throwIfAborted()
    mouth.onvalue = (name, value) => {
      if (head.mtAvatar[name]) Object.assign(head.mtAvatar[name], { newvalue: value, needsUpdate: true })
    }
    head.opt.update = mouth.update.bind(mouth)
    head.renderer.setClearColor(background, 0)
    // The preview scales in CSS. Camera and encoding always use project pixels.
    const canvas = head.renderer.domElement
    const bg = (graphics) => {
      const gradient = graphics.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, '#eff2e9')
      gradient.addColorStop(0.68, background)
      gradient.addColorStop(1, background)
      graphics.fillStyle = gradient
      graphics.fillRect(0, 0, w, h)
    }
    async function play(track, { signal, uploadUrl, subtitles = true, onCaption = () => {} }) {
      signal.throwIfAborted()
      await ctx.resume()
      const response = await fetch(track.url, { signal })
      if (!response.ok) throw new Error('无法读取本机音轨')
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer())
      signal.throwIfAborted()
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const out = ctx.createMediaStreamDestination()
      source.connect(mouth)
      source.connect(out)
      if (!uploadUrl) source.connect(ctx.destination)
      const mix = document.createElement('canvas')
      mix.width = w
      mix.height = h
      const graphics = mix.getContext('2d', { alpha: false })
      let stream,
        recorder,
        parts = 0,
        queued = 0,
        uploadError,
        writer = Promise.resolve(),
        recorded,
        frame = 0
      const started = ctx.currentTime + 0.12
      let caption = '',
        lastPaint = -Infinity
      function paint() {
        const time = ctx.currentTime - started
        const text = subtitles ? track.cues.find((c) => c.start <= time && time < c.end)?.text || '' : ''
        if (text !== caption) {
          caption = text
          onCaption(text)
        }
        if (uploadUrl && time - lastPaint >= 1 / 30) {
          lastPaint = time
          bg(graphics)
          head.render()
          graphics.drawImage(canvas, 0, 0, w, h)
          drawCaption(graphics, text, w, h)
        }
        frame = requestAnimationFrame(paint)
      }
      const stop = () => {
        try {
          source.stop()
        } catch {}
      }
      signal.addEventListener('abort', stop, { once: true })
      try {
        const ended = new Promise((resolve) => {
          source.onended = resolve
        })
        if (uploadUrl) {
          paint()
          stream = mix.captureStream(24)
          for (const t of out.stream.getAudioTracks()) stream.addTrack(t)
          recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp8,opus',
            videoBitsPerSecond: 2_400_000,
          })
          recorded = new Promise((resolve, reject) => {
            recorder.onstop = resolve
            recorder.onerror = (e) => {
              uploadError = e.error || new Error('录制失败')
              stop()
              reject(uploadError)
            }
          })
          recorded.catch(() => {})
          recorder.ondataavailable = (event) => {
            if (!event.data.size || uploadError) return
            const blob = event.data
            queued += blob.size
            if (queued > 16 * 1024 * 1024) {
              uploadError = new Error('本机写入过慢，录制已停止')
              stop()
              return
            }
            writer = writer
              .then(async () => {
                if (uploadError) return
                for (let i = 0; i < blob.size; i += 1024 * 1024) {
                  const response = await fetch(uploadUrl + '?part=' + parts, {
                    method: 'POST',
                    body: blob.slice(i, i + 1024 * 1024),
                    signal,
                  })
                  if (!response.ok) throw new Error('保存录制分片失败：' + response.status)
                  parts++
                }
                queued -= blob.size
              })
              .catch((e) => {
                uploadError = e
                stop()
              })
          }
          recorder.start(500)
        } else paint()
        source.start(started)
        await ended
        if (recorder?.state === 'recording') recorder.stop()
        if (recorded) await recorded
        await writer
        signal.throwIfAborted()
        if (uploadError) throw uploadError
        return parts
      } finally {
        signal.removeEventListener('abort', stop)
        cancelAnimationFrame(frame)
        if (recorder?.state === 'recording') recorder.stop()
        stream?.getTracks().forEach((t) => t.stop())
        out.stream.getTracks().forEach((t) => t.stop())
        stop()
        source.disconnect()
        out.disconnect()
        onCaption('')
      }
    }
    return { play, dispose }
  } catch (e) {
    dispose()
    throw e
  }
}
