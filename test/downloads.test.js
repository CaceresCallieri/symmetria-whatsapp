// Guards the download rules that fail silently.
//
// All of them are invisible when wrong. A bad `downloadOutcome` branch still
// saves the file correctly and merely says the wrong thing about it -- which
// is how the previous version came to report a cancelled download as a
// failure, with nothing in the app or the logs to show for it. A broken
// `uniqueSavePath` is worse than silent: it suggests a name that overwrites a
// file you already had, and the dialog's quickest answer accepts the
// suggestion. `sanitisedFilename` is the one with an attacker on the other
// side of it -- the name is the sender's, and these cases are the ones
// `path.basename` alone lets through.
//
// Only the pure rules are covered. Raising the dialog and the notification
// needs a real Electron runtime, which `node --test` is not.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  downloadOutcome,
  finishedFilename,
  sanitisedFilename,
  uniqueSavePath,
  MAX_FILENAME_CHARACTERS,
} = require('../src/main/downloads')

test('a completed download is announced on both surfaces', () => {
  const outcome = downloadOutcome('completed', 'photo.jpg')
  assert.equal(outcome.toast, 'Saved photo.jpg')
  assert.deepEqual(outcome.notification, { title: 'Download complete', body: 'photo.jpg' })
})

test('a cancelled download is never reported as a failure', () => {
  // Closing the save dialog produces this state. Calling it a failure is the
  // regression this test exists to catch.
  const outcome = downloadOutcome('cancelled', 'photo.jpg')
  assert.equal(outcome.toast, 'Cancelled photo.jpg')
  assert.doesNotMatch(outcome.toast, /fail/i)
})

test('a cancelled download raises no desktop notification', () => {
  // You cancelled it one second ago, so the notification would be noise.
  assert.equal(downloadOutcome('cancelled', 'photo.jpg').notification, null)
})

test('an interrupted download is announced on both surfaces', () => {
  const outcome = downloadOutcome('interrupted', 'photo.jpg')
  assert.equal(outcome.toast, 'Download failed: photo.jpg')
  assert.deepEqual(outcome.notification, { title: 'Download failed', body: 'photo.jpg' })
})

test('an unknown state is treated as a failure, not as a success', () => {
  // Electron documents three states. A fourth one arriving must not be able to
  // claim the file was saved when it was not.
  const outcome = downloadOutcome('something-new', 'photo.jpg')
  assert.equal(outcome.notification.title, 'Download failed')
})

test('the suggested name is the plain one when nothing is in the way', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'symmetria-downloads-'))
  try {
    assert.equal(uniqueSavePath(directory, 'photo.jpg'), path.join(directory, 'photo.jpg'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('the suggested name steps aside for files that already exist', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'symmetria-downloads-'))
  try {
    fs.writeFileSync(path.join(directory, 'photo.jpg'), 'first')
    assert.equal(uniqueSavePath(directory, 'photo.jpg'), path.join(directory, 'photo (1).jpg'))

    fs.writeFileSync(path.join(directory, 'photo (1).jpg'), 'second')
    assert.equal(uniqueSavePath(directory, 'photo.jpg'), path.join(directory, 'photo (2).jpg'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('the counter goes before the extension, not after the whole name', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'symmetria-downloads-'))
  try {
    fs.writeFileSync(path.join(directory, 'report.tar.gz'), 'first')
    // `path.extname` sees only the last extension, which is the behaviour to
    // record rather than to fix -- `report.tar (1).gz` still opens correctly.
    assert.equal(uniqueSavePath(directory, 'report.tar.gz'), path.join(directory, 'report.tar (1).gz'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a name with no extension still gets a counter', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'symmetria-downloads-'))
  try {
    fs.writeFileSync(path.join(directory, 'download'), 'first')
    assert.equal(uniqueSavePath(directory, 'download'), path.join(directory, 'download (1)'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('every outcome says something, whatever the state', () => {
  // src/renderer/shell.js shows `event.message` with no wording of its own, so
  // an outcome with an empty toast would be a download that reports nothing.
  for (const state of ['completed', 'cancelled', 'interrupted', 'something-new']) {
    assert.ok(downloadOutcome(state, 'photo.jpg').toast.length > 0, `empty toast for ${state}`)
  }
})

test('the saved name wins over the name the sender suggested', () => {
  // The dialog lets you rename. Reporting the suggestion then would name a
  // file that does not exist.
  assert.equal(finishedFilename('/home/u/Documents/holiday.jpg', 'IMG_0001.jpg'), 'holiday.jpg')
})

test('a dismissed dialog falls back to the suggested name', () => {
  // `item.getSavePath()` is empty in that case, and the cancellation message
  // still has to name something.
  assert.equal(finishedFilename('', 'IMG_0001.jpg'), 'IMG_0001.jpg')
})

test('a sender cannot aim the dialog outside the downloads directory', () => {
  // `path.basename` alone passes these through, and joining '..' onto the
  // downloads directory resolves to its parent.
  assert.equal(sanitisedFilename('..'), 'download')
  assert.equal(sanitisedFilename('.'), 'download')
  assert.equal(sanitisedFilename('a/../..'), 'download')
  assert.equal(sanitisedFilename('/etc/passwd'), 'passwd')
})

test('a sender cannot leave the download unnamed', () => {
  // An empty name would produce the toast 'Saved ', with no subject.
  for (const empty of ['', null, undefined]) {
    assert.equal(sanitisedFilename(empty), 'download')
  }
  assert.equal(downloadOutcome('completed', sanitisedFilename('')).toast, 'Saved download')
})

test('a NUL byte in the name is refused outright', () => {
  assert.equal(sanitisedFilename('photo\u0000.jpg'), 'download')
})

test('an overlong name is truncated but keeps its extension', () => {
  const name = `${'x'.repeat(400)}.jpg`
  const sanitised = sanitisedFilename(name)
  assert.ok(sanitised.length <= MAX_FILENAME_CHARACTERS, `too long: ${sanitised.length}`)
  assert.ok(sanitised.endsWith('.jpg'), `lost the extension: ${sanitised.slice(-10)}`)
})

test('an ordinary name is passed through untouched', () => {
  assert.equal(sanitisedFilename('holiday photo (2).jpeg'), 'holiday photo (2).jpeg')
})
