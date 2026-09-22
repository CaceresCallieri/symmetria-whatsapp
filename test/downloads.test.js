// Guards the two download rules that fail silently.
//
// Both are invisible when wrong. A bad `downloadOutcome` branch still saves
// the file correctly and merely says the wrong thing about it -- which is how
// the previous version came to report a cancelled download as a failure, with
// nothing in the app or the logs to show for it. A broken `uniqueSavePath`
// is worse than silent: it suggests a name that overwrites a file you already
// had, and the dialog's quickest answer accepts the suggestion.
//
// Only the pure rules are covered. Raising the dialog and the notification
// needs a real Electron runtime, which `node --test` is not.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { downloadOutcome, uniqueSavePath } = require('../src/main/downloads')

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
