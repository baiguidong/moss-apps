const segmenter = new Intl.Segmenter('zh', {granularity:'word'})
// Product names and conversational filler do not establish a topic match.
const filler = new Set(['moss','buddy','我','你','用户','的','了','是','在','有','和','与','要','就','把','被','给','也','都','能','能否','可以','不能','没有','不','没','不用','请','帮','帮我','一下','一点','这个','那个','当前','之前','现在','怎么','怎样','如何','为什么','什么','怎么办','使用','问题'])
const normalize = value => String(value).normalize('NFKC').toLowerCase()
const words = value => [...segmenter.segment(value)].filter(part=>part.isWordLike&&part.segment.length>1&&!filler.has(part.segment)).map(part=>part.segment)
function contains(text, term) {
  if (/^[a-z0-9_-]+$/i.test(term)) return new RegExp(`(?<![a-z0-9_])${term}(?![a-z0-9_])`, 'i').test(text)
  return text.includes(term)
}

/** Rank specific feature names above broad configuration words; unknown topics stay empty. */
export function searchHandbook(handbook, query, limit=6) {
  const normalized=normalize(query).trim()
  if(!normalized||['moss','buddy'].includes(normalized))return handbook.slice(0,limit)
  const tokens=[...new Set(words(normalized))]
  const entries=handbook.map(article=>({article,title:normalize(article.title),keywords:(article.keywords||[]).map(normalize),body:normalize(article.body)}))
  const frequency=term=>entries.filter(entry=>contains(`${entry.title} ${entry.keywords.join(' ')} ${entry.body}`,term)).length
  const weight=term=>1+Math.log((entries.length+1)/(frequency(term)+1))
  const ranked=entries.map(entry=>{
    const phrases=entry.keywords.filter(term=>term.length>1&&!filler.has(term)&&contains(normalized,term))
    const score=phrases.reduce((sum,term)=>sum+6*weight(term),0)+tokens.reduce((sum,term)=>sum+weight(term)*(contains(entry.title,term)?3:entry.keywords.some(keyword=>contains(keyword,term))?2:contains(entry.body,term)?1:0),0)
    return {article:entry.article,score}
  }).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score)
  return ranked.filter(entry=>entry.score>=ranked[0].score/4).slice(0,limit).map(entry=>entry.article)
}
