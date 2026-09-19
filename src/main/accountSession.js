// Per-account Electron session: the isolation boundary between accounts.
//
// Each account gets its own persistent partition, so cookies, localStorage and
// the WhatsApp login all stay separate. This is the Electron equivalent of the
// QWebEngineProfile-per-account arrangement the Qt version used, and it needs
// far less ceremony -- a persistent partition is persistent from the start,
// with no off-the-record phase to work around.

const path = require('node:path')
const { app, session } = require('electron')

const { allowExtensionFramesInSession } = require('./extensionFrameCsp')

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com'

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

function partitionNameFor(accountId) {
  return `persist:account-${accountId}`
}

/**
 * Builds the session for one account. Safe to call again for the same account:
 * Electron returns the existing session for a partition name.
 */
function createAccountSession(accountId, { onDownload } = {}) {
  const accountSession = session.fromPartition(partitionNameFor(accountId))

  accountSession.setUserAgent(chromeUserAgent())

  // Both handlers are needed. The request handler answers the prompt WhatsApp
  // raises the first time it wants the microphone; the check handler answers
  // the synchronous test some call paths make before even prompting, and
  // without it getUserMedia hands back a silent track rather than failing.
  accountSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.has(permission))
  })
  accountSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!GRANTED_PERMISSIONS.has(permission)) return false
    return requestingOrigin === '' || requestingOrigin.startsWith(WHATSAPP_ORIGIN)
  })

  // Without this, WhatsApp's CSP refuses the Surfingkeys UI frame and the
  // omnibar, the `:` commands and the key-sequence display all go missing.
  allowExtensionFramesInSession(accountSession)

  if (onDownload) attachDownloadHandler(accountSession, accountId, onDownload)

  return accountSession
}

// Saves attachments straight to the XDG download directory instead of raising a
// file dialog for every image. A dialog per download is the wrong default for a
// chat client, where saving a photo should cost one keystroke.
function attachDownloadHandler(accountSession, accountId, onDownload) {
  accountSession.on('will-download', (_event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(savePath)

    item.once('done', (_doneEvent, state) => {
      onDownload({
        accountId,
        filename: item.getFilename(),
        savePath,
        state, // 'completed' | 'cancelled' | 'interrupted'
      })
    })
  })
}

module.exports = { createAccountSession, chromeUserAgent, partitionNameFor, WHATSAPP_ORIGIN }
