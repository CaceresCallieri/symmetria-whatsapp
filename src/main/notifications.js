// Forwards WhatsApp Web's notifications to the desktop notification daemon
// (Symmetria Shell's notification center on the target system).
//
// The page's own `window.Notification` is replaced in src/preload/account.js so
// each alert arrives here first. Going through the main process is what buys
// the two things Chromium's built-in handling cannot give: the account name in
// the notification body, and a click that both focuses the window and switches
// to the account the message belongs to.
//
// A click is then handed back to the page. That round trip matters: WhatsApp's
// own click handler is what opens the chat the message came from, so without
// it a click would focus the right account and leave you on whatever chat
// happened to be open -- a regression against what Chromium does natively.
//
// Electron's Notification speaks to the daemon over libnotify, which covers the
// default click action. Extra actions -- an inline reply from the notification
// -- are not exposed by Electron on Linux. Reaching them means talking
// org.freedesktop.Notifications directly over D-Bus, the way the removed Qt
// NotificationHandler did. That is the upgrade path, not a limit of the design.

const { Notification, ipcMain } = require('electron')

const channels = require('../shared/channels')

// WhatsApp reuses one tag per chat so a new message replaces the previous
// alert rather than stacking. Electron's main-process Notification has no tag
// support, so the live notification for a tag is tracked here and closed
// before its replacement.
const liveNotificationsByTag = new Map()

// The page closes a notification by the id it minted, not by the chat tag, so
// a second index maps that id back to the tag key holding the live instance.
const tagKeyByNotificationId = new Map()

/**
 * @param {object} deps
 * @param {(accountId: string) => void} deps.onActivate  focus window, show account
 * @param {(webContents: Electron.WebContents) => string|null} deps.accountIdFor
 * @param {(accountId: string) => string} deps.accountNameFor
 * @param {(accountId: string, unreadCount: number) => void} deps.onUnreadChange
 */
function registerNotificationBridge({ onActivate, accountIdFor, accountNameFor, onUnreadChange }) {
  ipcMain.on(channels.NOTIFY, (event, payload) => {
    // The account is derived from the sender, never taken from the message.
    // A renderer could otherwise label its notification with another account's
    // name and steer the click there.
    const accountId = accountIdFor(event.sender)
    if (!accountId) return
    show(accountId, event.sender, payload, { onActivate, accountNameFor })
  })

  ipcMain.on(channels.UNREAD_REPORTED, (event, unreadCount) => {
    const accountId = accountIdFor(event.sender)
    if (!accountId) return
    onUnreadChange(accountId, Number(unreadCount) || 0)
  })

  // WhatsApp closes its own notifications when the chat is read elsewhere.
  // Without this the alert would sit on screen until the daemon expired it.
  ipcMain.on(channels.NOTIFICATION_CLOSED_BY_PAGE, (event, notificationId) => {
    const accountId = accountIdFor(event.sender)
    if (!accountId) return
    const key = tagKeyByNotificationId.get(notificationId)
    if (!key || !key.startsWith(`${accountId}:`)) return
    const live = liveNotificationsByTag.get(key)
    if (live) {
      liveNotificationsByTag.delete(key)
      tagKeyByNotificationId.delete(notificationId)
      live.close()
    }
  })
}

function tagKeyFor(accountId, tag) {
  return `${accountId}:${tag}`
}

function show(accountId, sender, payload, { onActivate, accountNameFor }) {
  if (!Notification.isSupported()) return

  const key = tagKeyFor(accountId, payload.tag || payload.title)

  // Delete before closing. `close()` fires its 'close' event asynchronously,
  // so a handler that deleted unconditionally would run *after* the
  // replacement was stored and evict it -- making the next message for this
  // chat stack instead of replace, which is the exact thing this map prevents.
  const previous = liveNotificationsByTag.get(key)
  if (previous) {
    liveNotificationsByTag.delete(key)
    previous.close()
  }

  const accountName = accountNameFor(accountId)

  const notification = new Notification({
    // The account name has to ride in the title, because the daemon shows one
    // application name for the whole app and cannot tell the accounts apart.
    title: accountName ? `${payload.title} — ${accountName}` : payload.title,
    body: payload.body || '',
    silent: false,
    urgency: 'normal',
  })

  notification.on('click', () => {
    onActivate(accountId)
    // Hand the click back so WhatsApp opens the chat it came from.
    if (!sender.isDestroyed()) {
      sender.send(channels.NOTIFICATION_CLICKED, payload.notificationId)
    }
  })

  notification.on('close', () => {
    // Only clear the entry if it is still this notification's. See above.
    if (liveNotificationsByTag.get(key) === notification) liveNotificationsByTag.delete(key)
    tagKeyByNotificationId.delete(payload.notificationId)
  })

  notification.show()
  liveNotificationsByTag.set(key, notification)
  tagKeyByNotificationId.set(payload.notificationId, key)
}

module.exports = { registerNotificationBridge }
