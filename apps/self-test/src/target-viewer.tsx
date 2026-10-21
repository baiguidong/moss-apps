import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from './lib/api';
import type { SelfTestInstanceStatus } from './types';

export function TargetViewer({ instance, running, onClose }: {
  instance: SelfTestInstanceStatus | null; running: boolean; onClose: () => void;
}) {
  const [frame, setFrame] = React.useState<{ image: string; width: number; height: number } | null>(null);
  const [error, setError] = React.useState('');
  const [revision, refresh] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    if (instance?.phase !== 'open') { setFrame(null); return; }
    let active = true;
    let timer: number;
    const capture = async () => {
      try {
        const next = await api.instanceFrame();
        if (active) { setFrame(next); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) timer = window.setTimeout(capture, running ? 1300 : 900);
      }
    };
    void capture();
    return () => { active = false; window.clearTimeout(timer); };
  }, [instance?.phase, running, revision]);

  const position = (event: React.MouseEvent<HTMLImageElement> | React.WheelEvent<HTMLImageElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(frame!.width, (event.clientX - box.left) * frame!.width / box.width)),
      y: Math.max(0, Math.min(frame!.height, (event.clientY - box.top) * frame!.height / box.height)) };
  };
  const input = async (value: Parameters<typeof api.instanceInput>[0]) => {
    try { await api.instanceInput(value); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="target-viewer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="target-viewer" role="dialog" aria-modal="true" aria-label="测试实例画面">
      <header><div><strong>测试实例</strong><span>{running ? '自测运行中 · 实时画面' : '可点击、滚动和输入'}</span></div>
        <button type="button" aria-label="关闭测试实例画面" onClick={onClose}><X size={18} /></button></header>
      <div className="target-viewer-screen" tabIndex={0} aria-label="测试实例交互画面"
        onKeyDown={event => {
          if (running) return;
          event.preventDefault();
          const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
            void input({ type: 'text', text: event.key });
          else void input({ type: 'key', key: event.key, code: event.code, keyCode: event.keyCode, modifiers });
        }}
        onPaste={event => { if (!running) { event.preventDefault(); void input({ type: 'text', text: event.clipboardData.getData('text').slice(0, 1000) }); } }}>
        {frame ? <img src={frame.image} alt="测试实例当前画面" draggable={false}
          onClick={event => { event.currentTarget.parentElement?.focus(); if (!running) void input({ type: 'click', ...position(event) }); }}
          onWheel={event => { if (!running) void input({ type: 'scroll', ...position(event), deltaX: event.deltaX, deltaY: event.deltaY }); }} />
          : <div className="target-viewer-wait"><Loader2 size={18} className="spin" />{instance?.phase === 'starting' ? instance.message : '正在连接测试实例画面…'}</div>}
      </div>
      {error && <p role="alert" className="target-viewer-error">{error}</p>}
      {running && <p className="target-viewer-note">自测正在操作此实例；结束后可手动操作。</p>}
    </section>
  </div>;
}
