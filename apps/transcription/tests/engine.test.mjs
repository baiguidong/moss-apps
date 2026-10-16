import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeTranscript, subtitleTime, validate } from '../src/backend/engine.mjs'

test('subtitle timing rounds across minute/hour boundaries and preserves Unicode', () => {
  assert.equal(subtitleTime(59.9996), '00:01:00,000')
  assert.equal(subtitleTime(3600.012, '.'), '01:00:00.012')
  const output = serializeTranscript([{ start: 0.1, end: 2.5, text: '你好，世界。' }, { start: 60, end: 63, text: 'Local transcription.' }])
  assert.match(output.srt, /1\n00:00:00,100 --> 00:00:02,500\n你好，世界。/)
  assert.match(output.vtt, /^WEBVTT\n\n00:00:00\.100/)
  assert.equal(output.txt, '你好，世界。\nLocal transcription.')
})
test('rejects unknown file and language before starting model work', () => {
  assert.throws(() => validate({ fileIds: ['absent'] }, []), /请选择/)
  assert.throws(() => validate({ fileIds: ['one'], options: { language: 'invalid' } }, [{ id: 'one', kind: 'audio' }]), /语言/)
  assert.equal(validate({ fileIds: ['one'] }, [{ id: 'one', kind: 'audio', name: '录音.wav' }]).options.language, 'auto')
})


test('native Whisper millisecond timestamps align with playback and subtitle seconds', async () => {
  const { normalizeSegments } = await import('../src/backend/engine.mjs')
  const segments = normalizeSegments([{ t0: 0, t1: 7600, text: ' First sentence ' }, { t0: 7600, t1: 10600, text: 'Second sentence' }], 11)
  assert.deepEqual(segments.map(s => [s.start, s.end]), [[0, 7.6], [7.6, 10.6]])
  assert.match(serializeTranscript(segments).srt, /00:00:07,600 --> 00:00:10,600/)
})
