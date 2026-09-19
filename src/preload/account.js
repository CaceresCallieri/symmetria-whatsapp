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

  // WhatsApp reuses one tag per chat so that a new message replaces the
  // previous alert. Reading an avatar is asynchronous, so two messages for the
  // same chat can finish out of order; this records which notification is the
  // newest for a tag, and an older one that finishes late is dropped rather
  // than allowed to replace it.
  const latestNotificationIdByTag = new Map()

  // The avatar WhatsApp passes as options.icon is a blob: URL, which exists
  // only inside this renderer -- the main process cannot read one. It is
  // therefore fetched here and handed over as inert bytes in a data URL.
  //
  // Fetching in the page is also the safer arrangement. The alternative is to
  // send the URL and let the main process fetch it, which would let a page
  // name any address for a privileged process to request.
  //
  // Both globals are captured now, at document start, because WhatsApp
  // replaces window.fetch with an instrumented version later in its boot.
  const pageFetch = window.fetch.bind(window)
  const PageFileReader = window.FileReader

  const ICON_TIMEOUT_MILLISECONDS = 2000
  const MAX_ICON_BYTES = 512 * 1024

  const readIcon = async (source) => {
    if (source.startsWith('data:image/')) return source

    const response = await pageFetch(source)
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    if (blob.size > MAX_ICON_BYTES) return null

    return await new Promise((resolve, reject) => {
      const reader = new PageFileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }

  // Never rejects and never hangs. WhatsApp revokes its blob URLs on its own
  // schedule, so a failed read is ordinary: it must cost the notification its
  // picture, never the notification itself.
  const readIconOrNothing = (source) =>
    Promise.race([
      readIcon(source).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, ICON_TIMEOUT_MILLISECONDS, null)),
    ])

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
      if (this.tag) latestNotificationIdByTag.set(this.tag, this._id)

      // Without an avatar there is nothing to wait for, so the notification
      // goes out in this turn. The common path must not become asynchronous
      // just because the uncommon one is.
      if (this.icon) {
        readIconOrNothing(this.icon).then((icon) => this._sendToMainProcess(icon))
      } else {
        this._sendToMainProcess(null)
      }
    }

    _sendToMainProcess(icon) {
      // Neither guard can fire on the synchronous path. They exist for the
      // avatar read: close() may have run while it was in flight, or a newer
      // message for the same chat may already have superseded this one.
      if (!liveNotifications.has(this._id)) return
      if (this.tag && latestNotificationIdByTag.get(this.tag) !== this._id) return

      bridge.notify({
        notificationId: this._id,
        title: this.title,
        body: this.body,
        tag: this.tag,
        icon: icon || '',
      })
    }

    close() {
      if (!liveNotifications.has(this._id)) return
      liveNotifications.delete(this._id)
      // Only when this is still the newest for the chat. Clearing it
      // unconditionally would let an already-superseded notification, closed
      // late, hand the tag back to nobody and let a stale read through.
      if (this.tag && latestNotificationIdByTag.get(this.tag) === this._id) {
        latestNotificationIdByTag.delete(this.tag)
      }
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
