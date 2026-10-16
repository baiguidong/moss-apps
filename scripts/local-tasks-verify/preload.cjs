const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('agentDesktop', {
  listApps: () => ipcRenderer.invoke('local-test:list-apps'),
  inspectAppMcpTools: input => ipcRenderer.invoke('local-test:inspect-mcp',input),
  onAppsChanged: callback => { const listener=()=>callback();ipcRenderer.on('local-test:apps-changed',listener);return ()=>ipcRenderer.removeListener('local-test:apps-changed',listener) },
  openEmbeddedApp: input => ipcRenderer.invoke('local-test:open', input),
  closeEmbeddedApp: input => ipcRenderer.invoke('local-test:close', input),
})
