import { applyEdits, createScanner, format, parseTree, type ParseError } from 'jsonc-parser/lib/esm/main.js'

// Format the original text so IDs larger than Number.MAX_SAFE_INTEGER stay intact.
export function formatJson(text: string): string {
  const scanner = createScanner(text)
  let depth = 0
  while (scanner.scan() !== 17) {
    const token = text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength())
    if ((token === '{' || token === '[') && ++depth > 128) throw new Error('JSON 嵌套超过 128 层。')
    if (token === '}' || token === ']') depth--
  }
  const errors: ParseError[] = []
  parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  if (errors.length) {
    const prefix = text.slice(0, errors[0]!.offset)
    throw new Error(`JSON 格式不正确：第 ${prefix.split(/\r\n|\r|\n/).length} 行，第 ${prefix.length - Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'))} 列。`)
  }
  return applyEdits(text, format(text, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' })).trim()
}
