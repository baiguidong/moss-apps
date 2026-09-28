// Select ESM explicitly: the UMD entry keeps relative require() calls in a Bun bundle.
import { applyEdits, createScanner, format, parseTree, printParseErrorCode, type ParseError } from 'jsonc-parser/lib/esm/main.js'
import type { JsonInput, JsonResult } from '../contracts'
import { checkedOutput, checkedText } from './encoding'
export function processJson(input: JsonInput): JsonResult {
  const text = checkedText(input.input)
  if (!text.trim()) throw new Error('请先输入 JSON。')
  if (!['format', 'minify', 'validate'].includes(input.operation)) throw new Error('请选择 JSON 操作。')
  if (!['2', '4', 'tab'].includes(input.indent)) throw new Error('请选择缩进方式。')
  const scanner = createScanner(text, false)
  let depth = 0, minified = ''
  while (true) {
    scanner.scan()
    if (scanner.getTokenLength() === 0) break
    const token = text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength())
    if (token === '{' || token === '[') {
      if (++depth > 128) throw new Error('JSON 嵌套超过 128 层，请简化内容。')
    } else if (token === '}' || token === ']') depth--
    if (token.trim()) minified += token
  }
  const errors: ParseError[] = []
  parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  if (errors.length) {
    const error = errors[0]!, prefix = text.slice(0, error.offset), line = prefix.split(/\r\n|\r|\n/).length
    const column = error.offset - Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'))
    const names: Record<string, string> = { InvalidSymbol: '存在无效字符', PropertyNameExpected: '属性名需要双引号', ValueExpected: '缺少有效的值', ColonExpected: '缺少冒号', CommaExpected: '缺少逗号', CloseBraceExpected: '缺少右大括号', CloseBracketExpected: '缺少右方括号', EndOfFileExpected: '末尾存在多余内容', InvalidCommentToken: '标准 JSON 不支持注释', UnexpectedEndOfString: '字符串未闭合', InvalidEscapeCharacter: '转义字符无效', InvalidUnicode: 'Unicode 转义无效', InvalidNumberFormat: '数字格式无效' }
    throw new Error(`第 ${line} 行，第 ${column} 列：${names[printParseErrorCode(error.error)] || 'JSON 格式不正确'}。`)
  }
  const result = input.operation === 'format' ? applyEdits(text, format(text, undefined, { insertSpaces: input.indent !== 'tab', tabSize: Number(input.indent) || 2, eol: '\n' })).trim()
    : input.operation === 'minify' ? minified : text
  return { ...checkedOutput(result), message: 'JSON 格式正确，数字精度与键顺序保持不变。' }
}
