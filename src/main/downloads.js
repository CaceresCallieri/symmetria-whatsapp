// Saving an attachment: where it goes, and how you learn that it arrived.
//
// The save location is chosen in a dialog rather than decided here. Electron
// raises that dialog only when `will-download` leaves the path unset, and on
// Linux it goes out over the XDG desktop portal -- so the file chooser that
// opens is the desktop's own, not a GTK dialog this app dictates.
//
// REGRESSION NOTE. This file used to call `item.setSavePath()` and save to the
// XDG download directory with no dialog at all, and the comment here argued
// for that: "a dialog per download is the wrong default for a chat client,
// where saving a photo should cost one keystroke". The user reversed that
// decision after using it. Do not restore the silent save as an "improvement"
// -- saving straight to a fixed directory is the behaviour that was rejected.
//
// A finished download is announced on two surfaces, which is not duplication.
// The dialog closes the moment you pick a name, but the transfer keeps going,
// so the toast is the in-app acknowledgement and the desktop notification is
// what reaches you once you have looked away.

// `electron` is required inside the functions that need it, never at the top.
// It is a prerequisite of `npm start` rather than an npm dependency, so
// `require('electron')` throws under plain Node -- and test/downloads.test.js
// covers the pure rules in this file with `node --test`.
const fs = require('node:fs')
const path = require('node:path')

/**
 * Picks a path inside `directory` that no file occupies yet, appending
 * ` (1)`, ` (2)` and so on before the extension.
 *
 * This still earns its place now that a dialog asks where to save. It only
 * supplies the *suggested* name, and the suggestion is the one accepted by
 * pressing Enter -- so without it the quickest possible answer to the dialog
 * is also the one that destroys the previous `image.jpg`.
 */
function uniqueSavePath(directory, filename) {
  const extension = path.extname(filename)
  const stem = path.basename(filename, extension)

  let candidate = path.join(directory, filename)
  for (let counter = 1; fs.existsSync(candidate); counter += 1) {
    candidate = path.join(directory, `${stem} (${counter})${extension}`)
  }
  return candidate
}

/**
 * What a finished download should say, on each of the two surfaces.
 *
 * Pure, and separated from the Electron calls, because this is the part that
 * fails silently: a wrong branch here shows the wrong wording, or shows
 * nothing, and the download itself still behaves correctly.
 *
 * `cancelled` gets a toast and no notification deliberately. Closing the save
 * dialog produces that state, and a desktop notification for an action taken
 * one second earlier is noise. The old code called this state
 * `Download failed`, which is what cancelling the dialog would now report.
 *
 * @param {string} state  'completed' | 'cancelled' | 'interrupted'
 * @param {string} filename
 * @returns {{toast: string, notification: {title: string, body: string}|null}}
 */
function downloadOutcome(state, filename) {
  if (state === 'completed') {
    return {
      toast: `Saved ${filename}`,
      notification: { title: 'Download complete', body: filename },
    }
  }
  if (state === 'cancelled') {
    return { toast: `Cancelled ${filename}`, notification: null }
  }
  return {
    toast: `Download failed: ${filename}`,
    notification: { title: 'Download failed', body: filename },
  }
}

/**
 * Raises the desktop notification for a finished download, when the outcome
 * calls for one.
 *
 * `revealPath` is passed only for a download that completed, because the click
 * handler needs a file that exists.
 */
function announce(outcome, revealPath) {
  if (!outcome.notification) return

  const { Notification, shell } = require('electron')
  if (!Notification.isSupported()) return

  // No `icon`: the daemon falls back to the application's own icon, which is
  // what this should show. Passing a present-but-empty icon would give a blank
  // image slot instead -- the same trap notifications.js documents.
  const notification = new Notification({
    title: outcome.notification.title,
    body: outcome.notification.body,
    urgency: 'low',
  })

  // Reveals the file in the file manager rather than opening it. The name came
  // from the sender over Content-Disposition, and handing a sender-named file
  // to the desktop's default application is the same class of mistake
  // src/main/externalLinks.js exists to prevent.
  if (revealPath) notification.on('click', () => shell.showItemInFolder(revealPath))

  notification.show()
}

/**
 * Attaches the save-and-announce behaviour to one account's session.
 *
 * Attaching twice would fire `onDownload` twice for every later download;
 * src/main/accountSession.js owns the guard that prevents it.
 *
 * @param {Electron.Session} accountSession
 * @param {string} accountId
 * @param {(event: object) => void} onDownload  surfaced to the shell as a toast
 */
function attachDownloadHandler(accountSession, accountId, onDownload) {
  const { app } = require('electron')

  accountSession.on('will-download', (_event, item) => {
    // The filename is remote-controlled through Content-Disposition, so it is
    // reduced to a bare basename before it can pre-fill the dialog with a
    // directory of the sender's choosing.
    const suggestedName = path.basename(item.getFilename()) || 'download'

    // Deliberately no `item.setSavePath()`. Leaving the path unset is the
    // whole mechanism: it is what makes Electron ask, and the ask is what
    // reaches the portal.
    item.setSaveDialogOptions({
      title: `Save ${suggestedName}`,
      defaultPath: uniqueSavePath(app.getPath('downloads'), suggestedName),
    })

    item.once('done', (_doneEvent, state) => {
      // Empty when the dialog was dismissed, so the suggested name is what the
      // cancellation message has to fall back to.
      const savePath = item.getSavePath()
      const filename = savePath ? path.basename(savePath) : suggestedName
      const outcome = downloadOutcome(state, filename)

      announce(outcome, state === 'completed' ? savePath : null)

      onDownload({
        accountId,
        filename,
        savePath,
        state, // 'completed' | 'cancelled' | 'interrupted'
        // The wording is decided here rather than in the renderer so that one
        // place owns it. The renderer used to re-derive it from `state` and
        // had no branch for a cancellation.
        message: outcome.toast,
      })
    })
  })
}

module.exports = { attachDownloadHandler, downloadOutcome, uniqueSavePath }
