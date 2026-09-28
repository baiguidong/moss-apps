const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('agentDesktop', {
  openEmbeddedApp: input => ipcRenderer.invoke('http-test:open-embed', input),
  closeEmbeddedApp: input => ipcRenderer.invoke('http-test:close-embed', input),
})
