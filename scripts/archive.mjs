import { zipSync } from 'fflate'

export function createDeterministicZip(entries) {
  // ZIP stores a local DOS calendar date. UTC midnight becomes 1979 in western
  // time zones, which is outside ZIP's supported range.
  const mtime = new Date(1980, 0, 1, 0, 0, 0)
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [
    name, [bytes, { mtime }],
  ])), { level: 9 }))
}
