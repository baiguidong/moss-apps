import { AppBackendClient } from '@moss/app-sdk'
const backend = new AppBackendClient()
backend.registerAction('example', async input => ({ value: input.value }))
backend.start()
