// Per-account Electron session: the isolation boundary between accounts.
//
// Each account gets its own persistent partition, so cookies, localStorage and
// the WhatsApp login all stay separate. This is the Electron equivalent of the
// QWebEngineProfile-per-account arrangement the Qt version used, and it needs
// far less ceremony -- a persistent partition is persistent from the start,
// with no off-the-record phase to work around.

const { session } = require('electron')

const { attachDownloadHandler } = require('./downloads')
const { allowExtensionFramesInSession } = require('./extensionFramePolicy')

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com'

// Tracks which partitions have already been configured. Electron returns the
// same session object for a partition name, and `will-download` is an event
// listener rather than a last-wins setter, so configuring a partition twice
// would fire every download callback twice.
const configuredPartitions = new Set()

// WhatsApp Web sniffs the user agent and serves an "update Google Chrome" wall
// when it sees the `Electron/<version>` token, so the session presents the plain
// Chrome string for the Chromium this build actually embeds. Reported by the
// spike in spike/surfingkeys-electron -- run it with and without `--ua=chrome`
// to reproduce the wall.
function chromeUserAgent() {
  const chromeMajorVersion = process.versions.chrome.split('.')[0]
  return (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${chromeMajorVersion}.0.0.0 Safari/537.36`
  )
}

// WhatsApp Web needs these to be a usable client: the microphone for voice
// notes, the camera for video calls, notifications for the message alerts the
// app forwards on, and the clipboard for copy and paste of message text.
const GRANTED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'background-sync',
])

/**
 * True only for WhatsApp Web itself.
 *
 * Compares parsed origins rather than string prefixes. A `startsWith` test
 * would also accept `https://web.whatsapp.com.evil.example` and
 * `https://web.whatsapp.com@attacker.test`, handing a hostile origin the
 * microphone and camera of a session that holds a live WhatsApp login.
 */
function isWhatsAppOrigin(value) {
  if (!value) return false
  try {
    return new URL(value).origin === WHATSAPP_ORIGIN
  } catch {
    return false
  }
}

function partitionNameFor(accountId) {
  return `persist:account-${accountId}`
}

/**
 * Builds the session for one account.
 *
 * Calling this again for the same account is safe but does nothing: the
 * partition is configured exactly once. That guard is not decoration --
 * `will-download` accumulates listeners, so a second unguarded call would make
 * every later download fire its callback twice.
 */
function createAccountSession(accountId, { onDownload } = {}) {
  const partition = partitionNameFor(accountId)
  const accountSession = session.fromPartition(partition)

  if (configuredPartitions.has(partition)) return accountSession
  configuredPartitions.add(partition)

  accountSession.setUserAgent(chromeUserAgent())

  // Both handlers are needed, and both check the origin. The request handler
  // answers the prompt WhatsApp raises the first time it wants the microphone;
  // the check handler answers the synchronous test some call paths make before
  // prompting, and without it getUserMedia hands back a silent track rather
  // than failing. Neither may grant on the permission name alone -- an embedded
  // third-party frame would inherit the microphone along with WhatsApp.
  accountSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!GRANTED_PERMISSIONS.has(permission)) return callback(false)
    const origin = details?.requestingUrl || webContents?.getURL()
    callback(isWhatsAppOrigin(origin))
  })
  accountSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!GRANTED_PERMISSIONS.has(permission)) return false
    return requestingOrigin === '' || isWhatsAppOrigin(requestingOrigin)
  })

  // Without this, WhatsApp's CSP refuses the Surfingkeys UI frame and the
  // omnibar, the `:` commands and the key-sequence display all go missing.
  allowExtensionFramesInSession(accountSession)

  if (onDownload) attachDownloadHandler(accountSession, accountId, onDownload)

  return accountSession
}

module.exports = {
  createAccountSession,
  chromeUserAgent,
  isWhatsAppOrigin,
  WHATSAPP_ORIGIN,
}
