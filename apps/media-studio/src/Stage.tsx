import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { openStage, frameSize } from './avatar-renderer.mjs'
import type { Call, Settings } from './types'

export type StageHandle = { play: (track: any, signal: AbortSignal, uploadUrl?: string) => Promise<number> }
export const Stage = forwardRef<
  StageHandle,
  { settings: Settings; call: Call; onReady: (ready: boolean, error?: string) => void }
>(function Stage({ settings, call, onReady }, ref) {
  const outer = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    stage = useRef<Awaited<ReturnType<typeof openStage>> | null>(null)
  const [scale, setScale] = useState(1),
    [status, setStatus] = useState('正在载入角色…'),
    [caption, setCaption] = useState(''),
    [attempt, retry] = useState(0)
  const { avatarId, aspect, quality, camera, background, subtitles } = settings
  const [w, h] = frameSize(aspect, quality)
  useEffect(() => {
    const el = outer.current!
    const fit = () => setScale(el.clientWidth / w)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [w])
  useEffect(() => {
    const controller = new AbortController(),
      el = document.createElement('div')
    el.style.cssText = 'width:100%;height:100%'
    host.current!.appendChild(el)
    setStatus('正在载入角色…')
    onReady(false)
    void (async () => {
      const { url } = await call('avatars.get', { id: avatarId }, controller.signal)
      controller.signal.throwIfAborted()
      const instance = await openStage(
        el,
        { avatarUrl: url, camera, background, aspect, quality },
        controller.signal,
      )
      if (controller.signal.aborted) {
        instance.dispose()
        return
      }
      stage.current = instance
      setStatus('')
      onReady(true)
    })().catch((e) => {
      if (!controller.signal.aborted) {
        setStatus(e.message)
        onReady(false, e.message)
      }
    })
    return () => {
      controller.abort()
      onReady(false)
      stage.current?.dispose()
      stage.current = null
      el.remove()
    }
  }, [avatarId, aspect, quality, camera, background, attempt, call, onReady])
  useImperativeHandle(
    ref,
    () => ({
      async play(track, signal, uploadUrl) {
        if (!stage.current) throw new Error('角色预览尚未就绪')
        return stage.current.play(track, { signal, uploadUrl, subtitles, onCaption: setCaption } as any)
      },
    }),
    [subtitles],
  )
  return (
    <div
      className={'stage ' + (aspect === '9:16' ? 'portrait' : '')}
      ref={outer}
      style={{
        aspectRatio: w + '/' + h,
        background: 'linear-gradient(125deg,#eff2e9,' + background + ' 68%)',
      }}
    >
      <div
        className="render-surface"
        ref={host}
        style={{ width: w, height: h, transform: 'scale(' + scale + ')' }}
      />
      {caption && <span className="caption">{caption}</span>}
      {status && (
        <div className="stage-status" role="status">
          {status}
          {!status.includes('正在') && <button onClick={() => retry((n) => n + 1)}>重新载入</button>}
        </div>
      )}
    </div>
  )
})
