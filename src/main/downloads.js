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
// what reaches you once you have looked away. Both fire even when the window
// is focused: suppressing the notification then was considered and rejected,
// because the transient toast on its own is the feedback the user called
// insufficient in the first place.
//
// `electron` is required inside the functions that need it, never at the top.
// It is a prerequisite of `npm start` rather than an npm dependency, so
// `require('electron')` throws under plain Node -- and test/downloads.test.js
// covers the pure rules in this file with `node --test`.

const fs = require('node:fs')
const path = require('node:path')

// Leaves room under the 255-byte limit of the usual Linux filesystems for the
// ` (12)` a collision appends, and for multi-byte characters in the name.
const MAX_FILENAME_CHARACTERS = 200

// Desktop notifications that are still on screen.
//
// Electron's Notification is a JavaScript wrapper over a native object, and a
// bare local goes out of scope the moment `announce` returns. Holding a
// reference until the notification closes is what stops the garbage collector
// taking it -- and with it the click handler that reveals the file.
// src/main/notifications.js keeps a comparable map for its own reasons.
const liveNotifications = new Set()

/**
 * The sender's filename, reduced to something safe to put in a dialog.
 *
 * The name arrives over `Content-Disposition` and is entirely the sender's
 * choice. `path.basename` alone is not enough: it passes `.` and `..`
 * straight through, and `join(downloadsDirectory, '..')` is the *parent* of
 * the downloads directory, so the dialog would open pre-filled somewhere the
 * user never asked to go. The version of this file before the dialog existed
 * had an explicit containment check; this is what replaces it.
 */
function sanitisedFilename(rawName) {
  const base = path.basename(String(rawName || ''))

  if (base === '' || base === '.' || base === '..') return 'download'
  if (base.includes('\0')) return 'download'
  if (base.length <= MAX_FILENAME_CHARACTERS) return base

  // Truncate the stem rather than the whole name, so the extension survives
  // and the file still opens in the right application.
  const extension = path.extname(base)
  const stem = path.basename(base, extension)
  return stem.slice(0, MAX_FILENAME_CHARACTERS - extension.length) + extension
}

/**
 * The name to report for a finished download.
 *
 * `savePath` is empty when the dialog was dismissed, which is the only reason
 * the suggested name is still needed by this point. When it is set it wins,
 * because the user may have renamed the file in the dialog and reporting the
 * sender's suggestion then would name a file that does not exist.
 */
function finishedFilename(savePath, suggestedName) {
  return savePath ? path.basename(savePath) : suggestedName
}

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
 * What a finished download should say, on each of the two surfaces described
 * in the file header.
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
 * calls for one. `revealPath` is passed only for a download that completed,
 * because the click handler needs a file that exists.
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
  if (revealPath) {
    notification.on('click', () => {
      // A notification can sit on screen long enough for the file to be moved
      // or deleted. showItemInFolder does nothing at all on a missing path, so
      // the fallback at least opens the directory it was saved to.
      if (fs.existsSync(revealPath)) shell.showItemInFolder(revealPath)
      else shell.openPath(path.dirname(revealPath))
    })
  }

  const forget = () => liveNotifications.delete(notification)
  notification.on('close', forget)
  notification.on('click', forget)
  notification.on('failed', forget)

  liveNotifications.add(notification)
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
    const suggestedName = sanitisedFilename(item.getFilename())

    // Deliberately no `item.setSavePath()`. Leaving the path unset is the
    // whole mechanism: it is what makes Electron ask, and the ask is what
    // reaches the portal.
    item.setSaveDialogOptions({
      title: `Save ${suggestedName}`,
      defaultPath: uniqueSavePath(app.getPath('downloads'), suggestedName),
    })

    item.once('done', (_doneEvent, state) => {
      // Empty when the dialog was dismissed.
      const savePath = item.getSavePath()
      const filename = finishedFilename(savePath, suggestedName)
      const outcome = downloadOutcome(state, filename)

      if (state !== 'completed') {
        console.error(`[downloads] ${accountId}: ${state}: ${savePath || suggestedName}`)
      }

      // The toast goes out before the notification, and the notification is
      // guarded. A throw from the Electron Notification call used to escape
      // this listener with the toast still unsent, which left a finished
      // download with no feedback on any surface at all.
      onDownload({
        accountId,
        filename,
        state, // 'completed' | 'cancelled' | 'interrupted'
        // The wording is decided here rather than in the renderer so that one
        // place owns it. The renderer used to re-derive it from `state` and
        // had no branch for a cancellation. `savePath` is deliberately NOT
        // sent: the renderer has no use for an absolute path, and the other
        // fields are here for a consumer that wants to tell the cases apart.
        message: outcome.toast,
      })

      try {
        announce(outcome, state === 'completed' ? savePath : null)
      } catch (error) {
        console.error(`[downloads] could not raise the notification: ${error.message}`)
      }
    })
  })
}

module.exports = {
  attachDownloadHandler,
  downloadOutcome,
  finishedFilename,
  sanitisedFilename,
  uniqueSavePath,
  MAX_FILENAME_CHARACTERS,
}
