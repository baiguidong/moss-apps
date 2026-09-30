const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('agentDesktop', {
  openEmbeddedApp: input => ipcRenderer.invoke('library-test:open-embed', input),
  closeEmbeddedApp: input => ipcRenderer.invoke('library-test:close-embed', input),
})
