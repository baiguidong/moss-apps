import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { AppUiApi } from '@moss/app-sdk'
import { syncAppearance } from './appearance'

const saved = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let hostEvent: ((value: unknown) => void) | undefined
let stop: (() => void) | undefined
let info: () => Promise<unknown>
let media: EventTarget & { matches: boolean }
let root: { dataset: Record<string, string>; style: Record<string, string> }
let win: EventTarget, doc: EventTarget
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const api = { app: { getInfo: () => info() }, events: { on: (_name: string, callback: (value: unknown) => void) => {
  hostEvent = callback
  return () => { hostEvent = undefined }
} } } as unknown as AppUiApi
beforeEach(() => {
  root = { dataset: {}, style: {} }
  media = Object.assign(new EventTarget(), { matches: true })
  win = new EventTarget()
  doc = Object.assign(new EventTarget(), { documentElement: root, hidden: false })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: win }, document: { configurable: true, value: doc },
    matchMedia: { configurable: true, value: () => media },
  })
  info = async () => ({ appearance: { themeMode: 'light', cssThemeId: 'default' } })
})
afterEach(() => {
  stop?.(); stop = undefined
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
test('Host theme overrides OS and appearance events update all background presets', async () => {
  stop = syncAppearance(api); await flush()
  expect(root.dataset).toEqual({ theme: 'light', backgroundStyle: 'default' })
  for (const cssThemeId of ['grid-theme', 'dot-theme', 'gradient-theme', 'default']) {
    hostEvent?.({ themeMode: 'dark', cssThemeId })
    expect(root.dataset).toEqual({ theme: 'dark', backgroundStyle: cssThemeId })
    expect(root.style.colorScheme).toBe('dark')
  }
  media.matches = false; media.dispatchEvent(new Event('change'))
  expect(root.dataset.theme).toBe('dark')
})
test('system mode follows OS changes and validates unknown background values', async () => {
  stop = syncAppearance(api); await flush()
  hostEvent?.({ themeMode: 'system', cssThemeId: 'invalid' })
  expect(root.dataset).toEqual({ theme: 'dark', backgroundStyle: 'grid-theme' })
  media.matches = false; media.dispatchEvent(new Event('change'))
  expect(root.dataset.theme).toBe('light')
})
test('late initial response cannot overwrite newer Host appearance event', async () => {
  let resolve!: (value: unknown) => void
  info = () => new Promise(done => { resolve = done })
  stop = syncAppearance(api)
  hostEvent?.({ themeMode: 'dark', cssThemeId: 'dot-theme' })
  resolve({ appearance: { themeMode: 'light', cssThemeId: 'default' } }); await flush()
  expect(root.dataset).toEqual({ theme: 'dark', backgroundStyle: 'dot-theme' })
})
test('focus refresh recovers missed events and transient failures retain Host theme', async () => {
  stop = syncAppearance(api); await flush()
  info = async () => ({ appearance: { themeMode: 'dark', cssThemeId: 'gradient-theme' } })
  win.dispatchEvent(new Event('focus')); await flush()
  expect(root.dataset).toEqual({ theme: 'dark', backgroundStyle: 'gradient-theme' })
  info = async () => { throw new Error('disconnected') }
  doc.dispatchEvent(new Event('visibilitychange')); await flush()
  expect(root.dataset).toEqual({ theme: 'dark', backgroundStyle: 'gradient-theme' })
})
test('cleanup removes listeners and ignores an in-flight response', async () => {
  let resolve!: (value: unknown) => void, reads = 0
  info = () => { reads++; return new Promise(done => { resolve = done }) }
  stop = syncAppearance(api)
  const before = { ...root.dataset }
  stop()
  resolve({ appearance: { themeMode: 'light', cssThemeId: 'default' } }); await flush()
  win.dispatchEvent(new Event('focus')); doc.dispatchEvent(new Event('visibilitychange'))
  media.matches = false; media.dispatchEvent(new Event('change')); await flush()
  expect(root.dataset).toEqual(before)
  expect(hostEvent).toBeUndefined()
  expect(reads).toBe(1)
})
