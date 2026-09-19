// Preload for an account's WhatsApp Web view.
//
// The patches applied here all target browser APIs rather than WhatsApp's own
// markup. That distinction matters: the project abandoned DOM injection because
// reading WhatsApp's markup broke on every redesign. Patching
// `window.Notification` or `navigator.storage` is a contract with the browser,
// so a redesign cannot break it. The one piece of WhatsApp state read directly
// is `document.title`, whose `(12)` prefix has held its shape for a decade --
// and a change there costs a wrong badge, never a broken app.
//
// The preload runs isolated from the page, so it cannot assign to main-world
// globals directly. It exposes a bridge with contextBridge, then injects the
// patches into the main world with webFrame.executeJavaScript.

const { contextBridge, ipcRenderer, webFrame } = require('electron')

// Channel names are inlined rather than required from src/shared/channels.js.
// This preload runs sandboxed -- electron-chrome-extensions requires it -- and
// a sandboxed preload's `require` resolves only a small polyfilled set of
// built-ins, never a local file. Requiring one throws before
// `exposeInMainWorld` runs, which takes down every patch in this file with no
// visible error: no notifications, no unread badge, no storage claim.
//
// test/channels.test.js asserts these match src/shared/channels.js, so drift
// fails a test run rather than silently breaking the bridge.
const channels = {
  NOTIFY: 'symmetria:notify',
  UNREAD_REPORTED: 'symmetria:unread',
  NOTIFICATION_CLOSED_BY_PAGE: 'symmetria:notification-close',
  NOTIFICATION_CLICKED: 'symmetria:notification-click',
}

const BRIDGE_NAME = '__symmetriaAccountBridge'
const accountId = process.argv
  .find((argument) => argument.startsWith('--symmetria-account-id='))
  ?.split('=')[1]

// Without an account id the main process cannot attribute anything this view
// sends, so the bridge is left undefined and the main-world patch takes its
// early-return path. Silence here would mean notifications and badges simply
// never appearing, with nothing to explain why.
if (!accountId) {
  console.error(
    '[preload] no --symmetria-account-id argument; notifications and unread badges are disabled ' +
      'for this view. It was probably created without additionalArguments.'
  )
} else {
  contextBridge.exposeInMainWorld(BRIDGE_NAME, {
    notify: (payload) => ipcRenderer.send(channels.NOTIFY, payload),
    closeNotification: (notificationId) =>
      ipcRenderer.send(channels.NOTIFICATION_CLOSED_BY_PAGE, notificationId),
    reportUnread: (unreadCount) => ipcRenderer.send(channels.UNREAD_REPORTED, unreadCount),
    onNotificationClicked: (callback) =>
      ipcRenderer.on(channels.NOTIFICATION_CLICKED, (_event, notificationId) =>
        callback(notificationId)
      ),
  })
}

// Runs in the page's main world, before WhatsApp's own scripts.
const MAIN_WORLD_PATCHES = `(() => {
  const bridge = window.${BRIDGE_NAME}
  if (!bridge) return

  // 1. Route notifications through the main process.
  //
  // Chromium would otherwise show them itself, which loses the account name and
  // gives a click nowhere useful to go. The replacement keeps the parts of the
  // Notification interface WhatsApp actually touches -- the constructor, the
  // permission statics, close() and the click event -- so the app cannot tell
  // the difference.
  const NativeNotification = window.Notification

  // Live shims, so a click or a close coming back from the main process can be
  // delivered to the object WhatsApp is holding.
  const liveNotifications = new Map()
  let nextNotificationId = 1

  class SymmetriaNotification extends EventTarget {
    constructor(title, options = {}) {
      super()
      this.title = title
      this.body = options.body || ''
      this.tag = options.tag || ''
      this.icon = options.icon || ''
      this.data = options.data
      this.onclick = null
      this.onclose = null
      this.onerror = null
      this.onshow = null

      this._id = nextNotificationId++
      liveNotifications.set(this._id, this)

      bridge.notify({
        notificationId: this._id,
        title,
        body: this.body,
        tag: this.tag,
      })
    }

    close() {
      if (!liveNotifications.has(this._id)) return
      liveNotifications.delete(this._id)
      bridge.closeNotification(this._id)
      const event = new Event('close')
      this.dispatchEvent(event)
      if (typeof this.onclose === 'function') this.onclose(event)
    }

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

  // A click on the desktop notification comes back here. WhatsApp's own
  // handler is what opens the chat the message belongs to, so without this
  // the click would focus the account and leave the wrong chat on screen.
  bridge.onNotificationClicked((notificationId) => {
    const notification = liveNotifications.get(notificationId)
    if (!notification) return
    window.focus()
    const event = new Event('click')
    notification.dispatchEvent(event)
    if (typeof notification.onclick === 'function') notification.onclick(event)
  })

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
  // WhatsApp publishes it in the document title as a '(12)' prefix. The
  // observer watches the <head> subtree rather than the <title> element,
  // because a single-page app that replaces the title node instead of
  // mutating its text would leave an element-scoped observer attached to a
  // detached node -- freezing the badge at its last value, silently.
  let lastReportedUnread = null

  const readUnreadFromTitle = () => {
    const match = /^\\((\\d+)\\)/.exec(document.title || '')
    const unreadCount = match ? Number(match[1]) : 0
    // WhatsApp rewrites the title on typing indicators and connection changes
    // too, so an unconditional send would be a stream of identical messages.
    if (unreadCount === lastReportedUnread) return
    lastReportedUnread = unreadCount
    bridge.reportUnread(unreadCount)
  }

  const watchTitle = () => {
    readUnreadFromTitle()
    const root = document.head || document.documentElement
    if (!root) return
    new MutationObserver(readUnreadFromTitle).observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    })
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
