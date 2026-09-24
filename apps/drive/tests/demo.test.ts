import { expect, test } from 'bun:test'
import { createDemoApi } from '../src/lib/demo'

test('deleting a demo file pauses its download and cannot resume into a false success', async () => {
  const api = createDemoApi()
  try {
    const created = await api.request('downloads.start', { fileId: 'intro' })
    await api.request('files.delete', { fileId: 'intro' })
    expect(await api.request('transfers.get', created)).toMatchObject({ state: 'paused', error: 'FILE_NOT_FOUND' })
    await expect(api.request('transfers.resume', created)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    expect(await api.request('transfers.cancel', created)).toMatchObject({ state: 'cancelled' })
    expect((await api.request('files.list', {})).files.some(file => file.id === 'intro')).toBe(false)
  } finally { api.dispose() }
})
