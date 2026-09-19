// Preload for the app's own chrome (title bar and account sidebar).
//
// The renderer is local, trusted markup, but it still runs context-isolated
// with no Node access, so this is the only surface it has to the main process.
// Keeping the surface this narrow means a hypothetical injection into the
// sidebar cannot reach the filesystem.

const { contextBridge, ipcRenderer } = require('electron')

// Inlined, not required: this preload runs sandboxed, and a sandboxed
// preload's `require` cannot resolve a local file. See the longer note in
// src/preload/account.js. test/channels.test.js keeps these in step with
// src/shared/channels.js.
const channels = {
  SHELL_STATE: 'symmetria:shell-state',
  SELECT_ACCOUNT: 'symmetria:select-account',
  WINDOW_ACTION: 'symmetria:window',
  ACTIVE_ACCOUNT: 'symmetria:active-account',
  UNREAD_CHANGED: 'symmetria:unread-changed',
  DOWNLOAD: 'symmetria:download',
  WINDOW_STATE: 'symmetria:window-state',
}

contextBridge.exposeInMainWorld('symmetria', {
  getShellState: () => ipcRenderer.invoke(channels.SHELL_STATE),

  selectAccount: (accountId) => ipcRenderer.send(channels.SELECT_ACCOUNT, accountId),

  minimize: () => ipcRenderer.send(channels.WINDOW_ACTION, 'minimize'),
  toggleMaximize: () => ipcRenderer.send(channels.WINDOW_ACTION, 'toggle-maximize'),
  close: () => ipcRenderer.send(channels.WINDOW_ACTION, 'close'),

  onActiveAccount: (callback) =>
    ipcRenderer.on(channels.ACTIVE_ACCOUNT, (_event, accountId) => callback(accountId)),

  onUnread: (callback) =>
    ipcRenderer.on(channels.UNREAD_CHANGED, (_event, accountId, unreadCount) =>
      callback(accountId, unreadCount)
    ),

  onDownload: (callback) =>
    ipcRenderer.on(channels.DOWNLOAD, (_event, download) => callback(download)),

  onWindowState: (callback) =>
    ipcRenderer.on(channels.WINDOW_STATE, (_event, state) => callback(state)),
})
