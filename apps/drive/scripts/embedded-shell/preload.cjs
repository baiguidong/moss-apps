const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('agentDesktop', {
  openEmbeddedApp: input => ipcRenderer.invoke('drive-test:open-embed', input),
  closeEmbeddedApp: input => ipcRenderer.invoke('drive-test:close-embed', input),
})
