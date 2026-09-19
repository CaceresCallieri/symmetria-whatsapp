// Forwards WhatsApp Web's notifications to the desktop notification daemon
// (Symmetria Shell's notification center on the target system).
//
// The page's own `window.Notification` is replaced in src/preload/account.js so
// each alert arrives here first. Going through the main process is what buys
// the two things Chromium's built-in handling cannot give: the account name in
// the notification body, and a click that both focuses the window and switches
// to the account the message belongs to.
//
// Electron's Notification speaks to the daemon over libnotify, which covers the
// default click action. Extra actions -- an inline reply from the notification
// -- are not exposed by Electron on Linux. Reaching them means talking
// org.freedesktop.Notifications directly over D-Bus, the way the removed Qt
// NotificationHandler did. That is the upgrade path, not a limit of the design.

const { Notification, ipcMain } = require('electron')

const NOTIFY_CHANNEL = 'symmetria:notify'
const UNREAD_CHANNEL = 'symmetria:unread'

// WhatsApp reuses one tag per chat so a new message replaces the previous
// alert rather than stacking. Electron has no tag support, so the live
// notification for a tag is tracked here and closed before its replacement.
const liveNotificationsByTag = new Map()

/**
 * @param {object} deps
 * @param {(accountId: string) => void} deps.onActivate  focus window, show account
 * @param {(accountId: string) => string} deps.accountNameFor
 * @param {(accountId: string, unreadCount: number) => void} deps.onUnreadChange
 */
function registerNotificationBridge({ onActivate, accountNameFor, onUnreadChange }) {
  ipcMain.on(NOTIFY_CHANNEL, (_event, accountId, payload) => {
    show(accountId, payload, { onActivate, accountNameFor })
  })

  ipcMain.on(UNREAD_CHANNEL, (_event, accountId, unreadCount) => {
    onUnreadChange(accountId, unreadCount)
  })
}

function show(accountId, payload, { onActivate, accountNameFor }) {
  if (!Notification.isSupported()) return

  const tagKey = `${accountId}:${payload.tag || payload.title}`
  const previous = liveNotificationsByTag.get(tagKey)
  if (previous) previous.close()

  const accountName = accountNameFor(accountId)

  const notification = new Notification({
    // The account name has to ride in the title, because the daemon shows one
    // application name for the whole app and cannot tell the accounts apart.
    title: accountName ? `${payload.title} — ${accountName}` : payload.title,
    body: payload.body || '',
    silent: false,
    urgency: 'normal',
  })

  notification.on('click', () => onActivate(accountId))
  notification.on('close', () => liveNotificationsByTag.delete(tagKey))

  notification.show()
  liveNotificationsByTag.set(tagKey, notification)
}

module.exports = { registerNotificationBridge, NOTIFY_CHANNEL, UNREAD_CHANNEL }
