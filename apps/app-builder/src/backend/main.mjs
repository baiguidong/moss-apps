import { AppBackendClient } from '@moss/app-sdk'
import { createBuilderActions } from './actions.mjs'
import { createProjectNotes } from './projects.mjs'

let notes
const backend = new AppBackendClient({ onInitialize(context) { notes = createProjectNotes(context.dataDir) } })
const actions = createBuilderActions((protocol, method, input) => backend.host.request(protocol, method, input), {
  all: () => notes.all(), save: (ref, value) => notes.save(ref, value),
})
for (const [name, handler] of Object.entries(actions)) backend.registerAction(name, handler)
backend.start()
