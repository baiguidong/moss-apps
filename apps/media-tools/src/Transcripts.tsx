import { TranscriptionPage } from '@moss/media-engines/transcription-page'
import base from '@moss/local-tasks/styles.css?inline'
import css from '@moss/media-engines/transcription.css?inline'
import { FeaturePage } from './FeaturePage'

export default function Transcripts({ initialId, dirtyChanged }: { initialId: string; dirtyChanged: (value:boolean) => void }) {
  return <FeaturePage css={base + css}><TranscriptionPage prefix="recording." initialTaskId={initialId} onDirty={dirtyChanged} /></FeaturePage>
}
