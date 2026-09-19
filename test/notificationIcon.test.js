// Guards the acceptance rules for a notification avatar.
//
// The avatar is the only page-controlled binary that the main process decodes,
// so these rules are a security boundary. They are also silent in both
// directions: too strict and the avatar just never appears, too loose and
// nothing visible happens at all. Neither shows up in the running app.
//
// Only the pure predicate is covered here. Building the NativeImage needs a
// real Electron runtime, which `node --test` is not -- Electron comes from the
// Arch package rather than node_modules.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isAcceptableIconDataUrl,
  MAX_ICON_DATA_URL_LENGTH,
} = require('../src/main/notificationIcon')

// A 1x1 transparent PNG.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk' +
  'YAAAAAYAAjCB0C8AAAAASUVORK5CYII='

test('accepts an image data URL', () => {
  assert.equal(isAcceptableIconDataUrl(TINY_PNG), true)
  assert.equal(isAcceptableIconDataUrl('data:image/jpeg;base64,/9j/4AAQ'), true)
})

test('rejects anything the main process would have to go and fetch', () => {
  // The whole point of converting the avatar in the page is that no
  // page-supplied address ever reaches the privileged process.
  assert.equal(isAcceptableIconDataUrl('https://pps.whatsapp.net/v/t61/avatar.jpg'), false)
  assert.equal(isAcceptableIconDataUrl('http://127.0.0.1:9222/json/list'), false)
  assert.equal(isAcceptableIconDataUrl('blob:https://web.whatsapp.com/a-uuid'), false)
  assert.equal(isAcceptableIconDataUrl('file:///etc/passwd'), false)
})

test('rejects a data URL that is not an image', () => {
  assert.equal(isAcceptableIconDataUrl('data:text/html;base64,PHNjcmlwdD4='), false)
  assert.equal(isAcceptableIconDataUrl('data:application/octet-stream;base64,AAAA'), false)
  // No media type at all defaults to text/plain, and must not pass on the
  // strength of the `data:` scheme alone.
  assert.equal(isAcceptableIconDataUrl('data:,hello'), false)
})

test('rejects a data URL past the size cap', () => {
  const oversized = `data:image/png;base64,${'A'.repeat(MAX_ICON_DATA_URL_LENGTH)}`
  assert.equal(isAcceptableIconDataUrl(oversized), false)
  assert.equal(isAcceptableIconDataUrl(`data:image/png;base64,${'A'.repeat(1024)}`), true)
})

test('rejects a missing or non-string icon', () => {
  // The payload comes from IPC, so the field can be any JSON value or absent.
  for (const value of [undefined, null, '', 0, 42, true, {}, [], Buffer.from('x')]) {
    assert.equal(isAcceptableIconDataUrl(value), false, `accepted ${JSON.stringify(value)}`)
  }
})
