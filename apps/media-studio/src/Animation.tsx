import { useCallback } from 'react'
import { AnimationPage } from '@moss/media-engines/animation-page'
import css from '@moss/media-engines/animation.css?inline'
import { FeaturePage } from './FeaturePage'
import type { Call } from './types'

export default function Animation({ call, dirtyChanged }: { call: Call; dirtyChanged: (value:boolean) => void }) {
  const action = useCallback((name:string, args:object = {}, signal?:AbortSignal) => {
    const input = args as Record<string, any>
    switch (name) {
      case 'projects.create': return call('video.save', { kind: 'animation', animation: input }, signal)
      case 'projects.storyboard.save':
      case 'projects.scene.save': return call('video.save', input, signal)
      case 'projects.validate': return call('media.get', { type: 'validate', id: input.id }, signal)
      case 'tasks.start': return call('video.render', { id: input.projectId, version: input.version, fps: input.fps, quality: input.quality }, signal)
      case 'projects.list':
      case 'templates.list': return call('animation.' + name, input, signal)
      default: return call(name, input, signal)
    }
  }, [call])
  return <FeaturePage css={css}><AnimationPage embedded projectToolbar action={action} onDirty={dirtyChanged} /></FeaturePage>
}
