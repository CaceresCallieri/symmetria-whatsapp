// Preload for an account's WhatsApp Web view.
//
// Three patches are applied to the page, all of them to browser APIs rather
// than to WhatsApp's own markup. That distinction matters: the project
// abandoned DOM injection because reading WhatsApp's markup broke on every
// redesign. Patching `window.Notification` or `navigator.storage` is a contract
// with the browser, not with WhatsApp, so a redesign cannot break it.
//
// The preload runs isolated from the page, so it cannot assign to main-world
// globals directly. It exposes a bridge with contextBridge, then injects the
// patches into the main world with webFrame.executeJavaScript.

const { contextBridge, ipcRenderer, webFrame } = require('electron')

const BRIDGE_NAME = '__symmetriaAccountBridge'
const accountId = process.argv
  .find((argument) => argument.startsWith('--symmetria-account-id='))
  ?.split('=')[1]

contextBridge.exposeInMainWorld(BRIDGE_NAME, {
  notify: (payload) => ipcRenderer.send('symmetria:notify', accountId, payload),
  reportUnread: (unreadCount) => ipcRenderer.send('symmetria:unread', accountId, unreadCount),
})

// Runs in the page's main world, before WhatsApp's own scripts.
const MAIN_WORLD_PATCHES = `(() => {
  const bridge = window.${BRIDGE_NAME}
  if (!bridge) return

  // 1. Route notifications through the main process.
  //
  // Chromium would otherwise show them itself, which loses the account name and
  // gives a click nowhere useful to go. The replacement keeps the parts of the
  // Notification interface WhatsApp actually touches -- the constructor, the
  // permission statics and close() -- so the app cannot tell the difference.
  const NativeNotification = window.Notification

  class SymmetriaNotification extends EventTarget {
    constructor(title, options = {}) {
      super()
      this.title = title
      this.body = options.body || ''
      this.tag = options.tag || ''
      this.icon = options.icon || ''
      this.onclick = null
      this.onclose = null
      this.onerror = null
      this.onshow = null
      bridge.notify({ title, body: this.body, tag: this.tag })
    }

    close() {}

    static requestPermission(callback) {
      if (callback) callback('granted')
      return Promise.resolve('granted')
    }
  }

  // WhatsApp gates its notification code on Notification.permission, and a
  // headless-looking 'default' makes it skip notifying altogether.
  Object.defineProperty(SymmetriaNotification, 'permission', {
    get: () => 'granted',
  })
  Object.defineProperty(SymmetriaNotification, 'maxActions', {
    get: () => (NativeNotification ? NativeNotification.maxActions : 2),
  })

  window.Notification = SymmetriaNotification

  // 2. Claim storage persistence.
  //
  // Chromium refuses navigator.storage.persist() without a user-engagement
  // signal it never collects in a wrapper, so WhatsApp logs
  // 'aquire-persistent-storage-denied' and treats its own storage as evictable.
  // The Qt version patched this the same way, for the same reason.
  if (navigator.storage) {
    navigator.storage.persist = () => Promise.resolve(true)
    navigator.storage.persisted = () => Promise.resolve(true)
  }

  // 3. Report the unread count to the sidebar badge.
  //
  // WhatsApp publishes it in the document title as a '(12)' prefix. Reading the
  // title is deliberate: it is the one piece of WhatsApp state with a stable,
  // decade-old shape, unlike anything in the DOM. A redesign that changed it
  // would cost a wrong badge, never a broken app.
  const readUnreadFromTitle = () => {
    const match = /^\\((\\d+)\\)/.exec(document.title || '')
    bridge.reportUnread(match ? Number(match[1]) : 0)
  }

  const watchTitle = () => {
    const titleElement = document.querySelector('title')
    if (!titleElement) return
    new MutationObserver(readUnreadFromTitle).observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    readUnreadFromTitle()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchTitle, { once: true })
  } else {
    watchTitle()
  }
})()`

webFrame.executeJavaScript(MAIN_WORLD_PATCHES).catch((error) => {
  console.error('[preload] main-world patches failed:', error)
})
