/** Parse only the text needed by the private-chat transport. */
export interface InboundPayload {
  text: string
  hasAttachments: boolean
}

export function extractInboundPayload(content: string, msgType: string): InboundPayload {
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    return { text: '', hasAttachments: false }
  }

  if (msgType === 'text') {
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      hasAttachments: false,
    }
  }

  if (msgType === 'image' || msgType === 'file' || msgType === 'file_archive') {
    return { text: '', hasAttachments: true }
  }

  if (msgType === 'post') {
    const nodes = (parsed.zh_cn?.content ?? parsed.en_us?.content ?? []) as any[]
    const flat = nodes.flat()
    return {
      text: flat
        .filter((node) => node?.tag === 'text' || node?.tag === 'md')
        .map((node) => node.text ?? node.content ?? '')
        .filter((value) => typeof value === 'string')
        .join(''),
      hasAttachments: flat.some((node) => node?.tag === 'img' || node?.tag === 'file'),
    }
  }

  return { text: '', hasAttachments: false }
}
