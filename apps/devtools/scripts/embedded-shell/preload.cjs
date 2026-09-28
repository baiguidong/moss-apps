const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('agentDesktop', {
  openEmbeddedApp: input => ipcRenderer.invoke('devtools-test:open-embed', input),
  closeEmbeddedApp: input => ipcRenderer.invoke('devtools-test:close-embed', input),
})
