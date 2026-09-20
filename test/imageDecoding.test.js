// Guards the pixel cap that both image decoders share.
//
// The cap is what stops a small compressed file from becoming a very large
// pixbuf, and the rule for applying it is easy to get subtly wrong: resizing
// the shorter side leaves the longer one over the cap, and the mistake is
// invisible because the picture still appears.
//
// `withinPixelCap` takes an already-built image rather than bytes, which is
// what makes it testable here. Electron is an Arch system package rather than
// a node_modules dependency, so `node --test` cannot create a real
// NativeImage -- the stub below stands in for one.

const test = require('node:test')
const assert = require('node:assert/strict')

const { withinPixelCap, isImageDataUrlWithin } = require('../src/main/imageDecoding')

function stubImage(width, height, { empty = false } = {}) {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    // Records the request instead of resizing, so a test can assert which
    // dimension was pinned.
    resize: (options) => ({ resizedWith: options }),
  }
}

test('rejects bytes that did not decode to a picture', () => {
  // Chromium signals an undecodable format with an empty image, not a throw.
  assert.equal(withinPixelCap(stubImage(0, 0, { empty: true }), 256), null)
})

test('returns an image already within the cap untouched', () => {
  const small = stubImage(96, 96)
  assert.equal(withinPixelCap(small, 256), small)

  // Exactly at the cap is within it.
  const exact = stubImage(256, 256)
  assert.equal(withinPixelCap(exact, 256), exact)
})

test('caps the longer side, so the shorter one keeps the aspect ratio', () => {
  assert.deepEqual(withinPixelCap(stubImage(2000, 1000), 256), {
    resizedWith: { width: 256 },
  })
  assert.deepEqual(withinPixelCap(stubImage(1000, 2000), 256), {
    resizedWith: { height: 256 },
  })
})

test('caps a square image by one side only', () => {
  // Pinning both would be equivalent here, but pinning one keeps the single
  // rule that the other cases rely on.
  assert.deepEqual(withinPixelCap(stubImage(512, 512), 96), {
    resizedWith: { width: 96 },
  })
})

test('caps an image that is over on one side only', () => {
  // The short side is already well inside the cap. Resizing by the long side
  // is still correct; resizing by the short side would not shrink anything.
  assert.deepEqual(withinPixelCap(stubImage(400, 10), 256), {
    resizedWith: { width: 256 },
  })
})

// --- isImageDataUrlWithin -------------------------------------------------
//
// The boundary between a page and an image decode in the privileged process.
// Both callers pass it data that WhatsApp's renderer built: the notification
// avatar and the account's own profile picture.

test('accepts an image data URL within the cap', () => {
  assert.equal(isImageDataUrlWithin('data:image/png;base64,iVBORw0KGgo=', 1024), true)
  assert.equal(isImageDataUrlWithin('data:image/jpeg;base64,/9j/4AAQ', 1024), true)
})

test('rejects anything the main process would have to go and fetch', () => {
  // The point of converting in the page is that no page-supplied address
  // ever reaches the privileged process.
  for (const source of [
    'https://pps.whatsapp.net/v/t61/avatar.jpg',
    'http://127.0.0.1:9222/json/list',
    'blob:https://web.whatsapp.com/a-uuid',
    'file:///etc/passwd',
  ]) {
    assert.equal(isImageDataUrlWithin(source, 1024), false, `accepted ${source}`)
  }
})

test('rejects a data URL that is not an image', () => {
  assert.equal(isImageDataUrlWithin('data:text/html;base64,PHNjcmlwdD4=', 1024), false)
  assert.equal(isImageDataUrlWithin('data:application/octet-stream;base64,AAAA', 1024), false)
  // No media type at all defaults to text/plain, and must not pass on the
  // strength of the `data:` scheme alone.
  assert.equal(isImageDataUrlWithin('data:,hello', 1024), false)
})

test('rejects a data URL past the cap it was given', () => {
  const long = `data:image/png;base64,${'A'.repeat(1024)}`
  assert.equal(isImageDataUrlWithin(long, 1024), false)
  assert.equal(isImageDataUrlWithin(long, 4096), true)
})

test('rejects a missing or non-string source', () => {
  // Both callers receive this over IPC, so it can be any JSON value or absent.
  for (const value of [undefined, null, '', 0, 42, true, {}, [], Buffer.from('x')]) {
    assert.equal(isImageDataUrlWithin(value, 1024), false, `accepted ${JSON.stringify(value)}`)
  }
})
