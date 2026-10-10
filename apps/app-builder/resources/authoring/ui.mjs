import { createAppClient } from '@moss/app-sdk/ui'
const client = createAppClient(window.mossApp)
const info = await client.app.getInfo()
document.documentElement.dataset.theme = info.appearance.themeMode
// Call only target App Actions declared by its own manifest:
// const result = await client.actions.invoke('example', { value: 'hello' })
window.addEventListener('pagehide', () => client.dispose(), { once: true })
