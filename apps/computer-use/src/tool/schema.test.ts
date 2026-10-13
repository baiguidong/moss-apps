import { expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { validateAppToolInputSchema } from '@moss/app-sdk'
import { computerUseInputSchema, computerUseInputJSONSchema, validateComputerUseOperation, type ComputerUseOperation } from './schema.js'

const validateModelInput = new Ajv2020({ strict: false }).compile(computerUseInputJSONSchema)
const window = { app: 'com.example.app', window_id: '42' }
const snapshot = { ...window, snapshot_id: 's00000001' }
const token = { element_token: 's00000001:2' }
const validOperations: ComputerUseOperation[] = [
  { action: 'status' },
  { action: 'list_apps', query: 'Example' },
  { action: 'launch_app', app: window.app },
  { action: 'list_windows', app: window.app },
  { action: 'get_window_state', ...window, include_screenshot: false, query: 'Search', max_elements: 1500, max_depth: 40 },
  { action: 'click', ...snapshot, ...token, ax_action: 'show_menu' },
  { action: 'click', ...snapshot, x: 0, y: 0, count: 2 },
  { action: 'type_text', ...snapshot, x: 30, y: 40, text: '你好 Moss' },
  { action: 'press_key', ...snapshot, key: 'tab', modifiers: ['shift'] },
  { action: 'hotkey', ...snapshot, ...token, keys: ['cmd', 'shift', 'z'] },
  { action: 'scroll', ...snapshot, ...token, direction: 'down', by: 'page', amount: 3 },
  { action: 'set_value', ...snapshot, ...token, value: '' },
  { action: 'end_session' },
]

test('the model schema preserves action branches inside an App-compatible object envelope', () => {
  expect(validateAppToolInputSchema(computerUseInputJSONSchema)).toBe(computerUseInputJSONSchema)
  expect(computerUseInputJSONSchema.required).toEqual(['request'])
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not']) {
    expect(computerUseInputJSONSchema).not.toHaveProperty(keyword)
  }
})

test('every exposed action passes the same model and runtime contract', () => {
  for (const request of validOperations) {
    const input = { request }
    expect(validateModelInput(input)).toBe(true)
    const parsed = computerUseInputSchema.parse(input)
    expect(parsed).toEqual(input)
    expect(validateComputerUseOperation(parsed.request)).toBeUndefined()
  }
})

test('both contracts reject extra fields, missing action parameters and host identity injection', () => {
  const invalidOperations = [
    { action: 'list_apps', include_screenshot: true },
    { action: 'end_session', app: window.app },
    { action: 'status', window_id: '42' },
    { action: 'launch_app' },
    { action: 'list_windows' },
    { action: 'get_window_state', app: window.app },
    { action: 'click', ...window, ...token },
    { action: 'type_text', ...snapshot },
    { action: 'press_key', ...snapshot },
    { action: 'hotkey', ...snapshot, keys: ['cmd'] },
    { action: 'scroll', ...snapshot },
    { action: 'set_value', ...snapshot, value: '1' },
    { action: 'set_value', ...snapshot, ...token, value: '1', foreground: true },
    { action: 'set_value', ...snapshot, ...token, value: '1', x: 1, y: 2 },
    { action: 'list_apps', pid: 42 },
    { action: 'list_apps', session: 'foreign' },
    { action: 'click', ...snapshot, target: { kind: 'desktop' } },
    { action: 'drag', ...snapshot },
    { action: 'get_window_state', ...window, max_elements: 1501 },
  ]
  for (const request of invalidOperations) {
    expect(validateModelInput({ request })).toBe(false)
    expect(computerUseInputSchema.safeParse({ request }).success).toBe(false)
  }
  for (const input of [{}, { action: 'status' }, { request: { action: 'status' }, app: window.app }]) {
    expect(validateModelInput(input)).toBe(false)
    expect(computerUseInputSchema.safeParse(input).success).toBe(false)
  }
})

test('addressing rules reject ambiguous targets before consuming a snapshot', () => {
  const invalid = [
    { action: 'click', ...snapshot },
    { action: 'click', ...snapshot, x: 10 },
    { action: 'type_text', ...snapshot, y: 10, text: 'test' },
    { action: 'scroll', ...snapshot, ...token, x: 1, y: 2, direction: 'down' },
    { action: 'click', ...snapshot, ...token, count: 2 },
    { action: 'click', ...snapshot, x: 1, y: 2, ax_action: 'press' },
  ]
  for (const request of invalid) {
    const parsed = computerUseInputSchema.parse({ request })
    expect(validateComputerUseOperation(parsed.request)).toBeString()
  }
})
