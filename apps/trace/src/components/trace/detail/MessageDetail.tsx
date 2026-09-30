import * as React from 'react'
// Adapted from cc-haha Trace; retain protocol and timeline semantics.
import { useMemo } from 'react'
import { useTranslation } from '@/lib/trace/i18n'
import type { MessageEntry } from '@/types/trace-session'
import type { TraceSpan } from '@/lib/trace/viewModel'
import { formatTraceJson } from '@/lib/trace/viewModel'
import type { NormalizedBlock, NormalizedMessage } from '../../../lib/trace/types'
import { normalizeContentBlock } from '../../../lib/trace/sse'
import { CodeViewer } from '@/components/chat/code-viewer'
import { EmptyState } from '@/components/trace/primitives'
import { Section } from './Section'
import { MessageBlocks } from './MessageBlocks'

export function MessageDetail({ span }: { span: TraceSpan }) {
  const t = useTranslation()
  const message = span.message
  const normalized = useMemo(
    () => message ? normalizeMessageEntry(message) : null,
    [message],
  )

  if (!message || !normalized) return null

  return (
    <div data-testid="trace-message-detail">
      <Section sectionKey="message.content" title={t('trace.section.content')} defaultOpen>
        {normalized.content.length > 0 ? (
          <MessageBlocks message={normalized} />
        ) : (
          <EmptyState description={t('trace.noData')} variant="dashed" size="sm" />
        )}
      </Section>
      <Section sectionKey="message.raw" title={t('trace.section.raw')}>
        <CodeViewer code={formatTraceJson(message.content)} language="json" maxLines={48} showLineNumbers />
      </Section>
    </div>
  )
}

function normalizeMessageEntry(message: MessageEntry): NormalizedMessage {
  const role: NormalizedMessage['role'] =
    message.type === 'assistant' || message.type === 'tool_use'
      ? 'assistant'
      : message.type === 'system'
        ? 'system'
        : message.type === 'tool_result'
          ? 'tool'
          : 'user'
  const content = message.content
  if (typeof content === 'string') {
    return { role, content: [{ type: 'text', text: content }] }
  }
  if (Array.isArray(content)) {
    const blocks = content
      .map((block) => normalizeContentBlock(block))
      .filter((block): block is NormalizedBlock => block !== null)
    return { role, content: blocks }
  }
  return { role, content: [] }
}
