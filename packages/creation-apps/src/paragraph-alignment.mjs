// Align unchanged text before pairing replacement blocks. Ordinal paragraph numbers
// remain navigation metadata, never identity across insertions or deletions.
export function alignParagraphs(before, after) {
  const token = u => u.text?.normalize('NFKC').replace(/\s+/gu, ' ').trim() || u.signature
  const a = before.map(token), b = after.map(token), matches = []
  function match(lo, hi, start, end) {
    while (lo < hi && start < end && a[lo] === b[start]) matches.push([lo++, start++])
    const suffix = []
    while (lo < hi && start < end && a[hi - 1] === b[end - 1]) suffix.push([--hi, --end])
    if (lo < hi && start < end) {
      const n = hi - lo, m = end - start
      if (n * m <= 1_000_000) {
        const dp = Array.from({length: n + 1}, () => new Uint32Array(m + 1))
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
          dp[i][j] = a[lo + i] === b[start + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        let i = 0, j = 0
        while (i < n && j < m) {
          if (a[lo + i] === b[start + j]) matches.push([lo + i++, start + j++])
          else if (dp[i + 1][j] >= dp[i][j + 1]) i++
          else j++
        }
      } else {
        // Bounded-memory monotonic anchors for very large documents.
        const positions = new Map()
        for (let j = start; j < end; j++) { const list = positions.get(b[j]) || []; list.push(j); positions.set(b[j], list) }
        let cursor = start
        for (let i = lo; i < hi; i++) {
          const list = positions.get(a[i]); if (!list) continue
          let l = 0, r = list.length
          while (l < r) { const mid = (l + r) >>> 1; if (list[mid] < cursor) l = mid + 1; else r = mid }
          if (l < list.length) { matches.push([i, list[l]]); cursor = list[l] + 1 }
        }
      }
    }
    matches.push(...suffix.reverse())
  }
  match(0, a.length, 0, b.length)
  const pairs = []
  const similarity = (x, y) => {
    x = x.slice(0, 1000); y = y.slice(0, 1000)
    if (x === y) return 1
    if (x.length < 2 || y.length < 2) return 0
    const grams = new Map(); let common = 0
    for (let k = 0; k < x.length - 1; k++) { const gram = x.slice(k,k+2); grams.set(gram,(grams.get(gram)||0)+1) }
    for (let k = 0; k < y.length - 1; k++) { const gram = y.slice(k,k+2), count = grams.get(gram)||0; if(count) { common++; grams.set(gram,count-1) } }
    return 2*common/(x.length+y.length-2)
  }
  function gap(i, x, j, y) {
    const n=x-i,m=y-j
    if(!n||!m||n*m>40000){while(i<x||j<y)pairs.push([i<x?before[i++]:undefined,j<y?after[j++]:undefined]);return}
    const scores=Array.from({length:n},(_,r)=>Array.from({length:m},(_,c)=>similarity(a[i+r],b[j+c])))
    const dp=Array.from({length:n+1},()=>new Float64Array(m+1))
    for(let r=n-1;r>=0;r--)for(let c=m-1;c>=0;c--)dp[r][c]=Math.max(dp[r+1][c],dp[r][c+1],scores[r][c]>=.3?scores[r][c]+dp[r+1][c+1]:0)
    if(!dp[0][0]){while(i<x||j<y)pairs.push([i<x?before[i++]:undefined,j<y?after[j++]:undefined]);return}
    let r=0,c=0
    while(r<n||c<m){
      if(r<n&&c<m&&scores[r][c]>=.3&&Math.abs(dp[r][c]-scores[r][c]-dp[r+1][c+1])<1e-6)pairs.push([before[i+r++],after[j+c++]])
      else if(r<n&&(c>=m||dp[r+1][c]>=dp[r][c+1]))pairs.push([before[i+r++],undefined])
      else pairs.push([undefined,after[j+c++]])
    }
  }
  let i = 0, j = 0
  for (const [x, y] of [...matches, [a.length, b.length]]) {
    gap(i, x, j, y)
    if (x < a.length) { pairs.push([before[x], after[y]]); i = x + 1; j = y + 1 }
  }
  return pairs
}
