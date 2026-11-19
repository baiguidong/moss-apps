import { useEffect, useRef, useState } from 'react'
import { Mic, Send, Square, Volume2 } from 'lucide-react'
import type { Call } from './types'

interface Message {
  id: string
  role: string
  text: string
}
interface ChatData {
  messages: Message[]
  persona: string
  pending: any
  error: string
}
export function Chat({
  avatarId,
  call,
  report,
  speak,
  stopAudio,
  speaking,
  useScript,
  canListen,
}: {
  avatarId: string
  call: Call
  report: (s: string) => void
  speak: (s: string) => Promise<void>
  stopAudio: () => void
  speaking: boolean
  useScript: (s: string) => void
  canListen: boolean
}) {
  const [data, setData] = useState<ChatData | null>(null),
    [input, setInput] = useState(''),
    [persona, setPersona] = useState(''),
    [auto, setAuto] = useState(true),
    [busy, setBusy] = useState(false),
    [mic, setMic] = useState(''),
    [pref, setPref] = useState(false)
  const [generation, refresh] = useState(0),
    tail = useRef<HTMLDivElement>(null)
  const latest = useRef({ auto, speak, report })
  latest.current = { auto, speak, report }
  const spoken = useRef<string | null>(null),
    released = useRef(true),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      released.current = true
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  useEffect(() => {
    let active = true,
      loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const value: ChatData = await call('chat.get', { avatarId })
        if (!active) return
        setData(value)
        const last = value.messages.filter((m) => m.role === 'assistant').at(-1)
        if (last && spoken.current !== null && spoken.current !== last.id && latest.current.auto)
          void latest.current.speak(last.text).catch((e) => latest.current.report(e.message))
        spoken.current = last?.id || ''
      } catch (e) {
        if (active) latest.current.report((e as Error).message)
      } finally {
        loading = false
      }
    }
    void load()
    const off = window.mossApp?.events.on('chat.changed', load)
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 2500)
    return () => {
      active = false
      off?.()
      clearInterval(timer)
    }
  }, [avatarId, call, generation])
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'nearest' })
  }, [data?.messages.length])
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      report((e as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function send(text: string) {
    if (!text.trim()) return
    stopAudio()
    const value = await call('chat.send', { avatarId, text: text.trim() })
    if (alive.current) {
      setData(value)
      setInput('')
      refresh((n) => n + 1)
    }
  }
  async function begin() {
    if (!canListen || busy || mic || data?.pending) return
    released.current = false
    setMic('正在打开麦克风')
    try {
      const tracks = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (released.current || !alive.current) {
        tracks.getTracks().forEach((t) => t.stop())
        setMic('')
        return
      }
      stream.current = tracks
      const rec = new MediaRecorder(tracks, { mimeType: 'audio/webm;codecs=opus' })
      recorder.current = rec
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      rec.onstop = async () => {
        clearTimeout(limit)
        tracks.getTracks().forEach((t) => t.stop())
        recorder.current = null
        stream.current = null
        if (!alive.current) return
        setMic('正在转写')
        await action(async () => {
          const ticket = await call('mic.begin')
          try {
            const response = await fetch(ticket.url + '?part=0', { method: 'POST', body: new Blob(chunks) })
            if (!response.ok) throw new Error('保存录音失败')
            const { text } = await call('mic.finish', { id: ticket.id })
            if (alive.current) await send(text)
          } catch (e) {
            await call('mic.finish', { id: ticket.id, discard: true }).catch(() => {})
            throw e
          }
        })
        if (alive.current) setMic('')
      }
      const limit = setTimeout(() => {
        if (rec.state === 'recording') rec.stop()
      }, 60000)
      rec.start()
      setMic('松开发送')
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop())
      setMic('')
      report((e as Error).message)
    }
  }
  function end() {
    released.current = true
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }
  return (
    <section className="editor chat">
      <div className="row spread">
        <h2>角色对话</h2>
        <button
          onClick={() => {
            setPersona(data?.persona || '')
            setPref(!pref)
          }}
        >
          人设
        </button>
      </div>
      {pref && (
        <div className="subform">
          <textarea
            aria-label="角色人设"
            maxLength={1000}
            rows={3}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setData(await call('chat.persona', { avatarId, persona }))
                setPref(false)
              })
            }
          >
            保存人设
          </button>
        </div>
      )}
      <div className="messages" aria-live="polite">
        {!data?.messages.length && <p className="muted">输入一句话，与这个角色开始对话。</p>}
        {data?.messages.map((m) => (
          <article className={'bubble ' + m.role} key={m.id}>
            <small>{m.role === 'user' ? '我' : 'Moss'}</small>
            <p>{m.text}</p>
            {m.role === 'assistant' && (
              <div className="row">
                <button onClick={() => useScript(m.text)}>用作讲稿</button>
                <button
                  aria-label="朗读回复"
                  disabled={speaking}
                  onClick={() => void speak(m.text).catch((e) => report(e.message))}
                >
                  <Volume2 size={15} />
                </button>
              </div>
            )}
          </article>
        ))}
        {data?.pending && <small>角色正在思考…</small>}
        {data?.error && <p role="alert">{data.error}</p>}
        <div ref={tail} />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked)
            if (!e.target.checked) stopAudio()
          }}
        />
        自动播报回复
      </label>
      <textarea
        aria-label="对话消息"
        placeholder="给角色发消息…"
        maxLength={4000}
        rows={3}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !busy && !data?.pending) {
            e.preventDefault()
            void action(() => send(input))
          }
        }}
      />
      <div className="row spread">
        <button
          disabled={!canListen || busy || !!data?.pending}
          title={canListen ? '最长 60 秒' : '安装并启用 Moss 语音转写后可用'}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            void begin()
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            if (e.code === 'Space' && !e.repeat) {
              e.preventDefault()
              void begin()
            }
          }}
          onKeyUp={(e) => {
            if (e.code === 'Space') {
              e.preventDefault()
              end()
            }
          }}
        >
          <Mic size={15} />
          {mic || '按住说话'}
        </button>
        {(data?.pending || speaking) && (
          <button
            onClick={() =>
              void action(async () => {
                stopAudio()
                if (data?.pending) setData(await call('chat.stop', { avatarId }))
              })
            }
          >
            <Square size={14} />
            停止
          </button>
        )}
        <button
          className="primary"
          disabled={busy || !!data?.pending || !input.trim()}
          onClick={() => void action(() => send(input))}
        >
          <Send size={15} />
          发送
        </button>
      </div>
    </section>
  )
}
