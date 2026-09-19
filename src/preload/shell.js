// Preload for the app's own chrome (title bar and account sidebar).
//
// The renderer is local, trusted markup, but it still runs context-isolated
// with no Node access, so this is the only surface it has to the main process.
// Keeping the surface this narrow means a hypothetical injection into the
// sidebar cannot reach the filesystem.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('symmetria', {
  getShellState: () => ipcRenderer.invoke('symmetria:shell-state'),

  selectAccount: (accountId) => ipcRenderer.send('symmetria:select-account', accountId),

  minimize: () => ipcRenderer.send('symmetria:window', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('symmetria:window', 'toggle-maximize'),
  close: () => ipcRenderer.send('symmetria:window', 'close'),

  onActiveAccount: (callback) =>
    ipcRenderer.on('symmetria:active-account', (_event, accountId) => callback(accountId)),

  onUnread: (callback) =>
    ipcRenderer.on('symmetria:unread', (_event, accountId, unreadCount) =>
      callback(accountId, unreadCount)
    ),

  onDownload: (callback) =>
    ipcRenderer.on('symmetria:download', (_event, download) => callback(download)),
})
