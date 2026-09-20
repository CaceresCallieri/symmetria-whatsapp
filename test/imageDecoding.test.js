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

const {
  withinPixelCap,
  isImageDataUrlWithin,
  withinDecodeBudget,
  declaredDimensions,
  bytesFromImageDataUrl,
  MAX_DECODED_PIXELS,
} = require('../src/main/imageDecoding')

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

// --- declaredDimensions / withinDecodeBudget ------------------------------
//
// The pixel cap above bounds what the app *keeps*. It cannot bound the
// decode, because the bytes are fully decompressed before any size is
// readable -- a 28 KB PNG declaring 9000x9000 allocates ~324 MB in the
// privileged main process before `withinPixelCap` ever runs. These read the
// dimensions out of the file header instead, before a decoder sees anything.

/** A PNG header with the given dimensions. Only the IHDR fields matter. */
function pngHeader(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/** A JPEG with one APP0 segment before the SOF0 that carries the size. */
function jpegHeader(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const sof0 = Buffer.alloc(11)
  sof0.writeUInt16BE(0xffc0, 0)
  sof0.writeUInt16BE(8, 2)
  sof0.writeUInt8(8, 4)
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.alloc(8)])
}

test('reads the dimensions out of a PNG header', () => {
  assert.deepEqual(declaredDimensions(pngHeader(96, 96)), { width: 96, height: 96 })
  assert.deepEqual(declaredDimensions(pngHeader(9000, 4000)), { width: 9000, height: 4000 })
})

test('reads the dimensions out of a JPEG header, past earlier segments', () => {
  // The size lives in a start-of-frame segment, which is not the first one.
  assert.deepEqual(declaredDimensions(jpegHeader(640, 480)), { width: 640, height: 480 })
})

test('reports nothing for a format whose header it does not read', () => {
  assert.equal(declaredDimensions(Buffer.from('GIF89a and then some bytes')), null)
  assert.equal(declaredDimensions(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  assert.equal(declaredDimensions(Buffer.alloc(0)), null)
  // Truncated mid-header, which is how a corrupt file arrives.
  assert.equal(declaredDimensions(pngHeader(96, 96).subarray(0, 20)), null)
})

test('refuses bytes that declare more pixels than the budget', () => {
  // A flat 9000x9000 PNG is ~28 KB on the wire and ~324 MB decoded, so no
  // byte cap can catch it.
  assert.equal(withinDecodeBudget(pngHeader(9000, 9000)), false)
  assert.equal(withinDecodeBudget(jpegHeader(20000, 20000)), false)
})

test('passes an ordinary picture, and anything it cannot read', () => {
  assert.equal(withinDecodeBudget(pngHeader(96, 96)), true)
  assert.equal(withinDecodeBudget(jpegHeader(4000, 3000)), true)
  // Exactly at the budget is within it.
  assert.equal(withinDecodeBudget(pngHeader(MAX_DECODED_PIXELS, 1)), true)
  assert.equal(withinDecodeBudget(pngHeader(MAX_DECODED_PIXELS + 1, 1)), false)
  // An unreadable header is left to the decoder, which is what refused it
  // before this guard existed. This narrows a blast radius; it does not
  // decide what counts as an image.
  assert.equal(withinDecodeBudget(Buffer.from('not an image at all')), true)
})

test('decodes the bytes carried by a base64 image data URL', () => {
  const source = `data:image/png;base64,${pngHeader(96, 96).toString('base64')}`
  assert.deepEqual(declaredDimensions(bytesFromImageDataUrl(source)), { width: 96, height: 96 })
})

test('refuses a data URL that carries no base64 payload', () => {
  // Both producers of these URLs are ours and both emit base64, so a
  // percent-encoded one is not something this app makes.
  assert.equal(bytesFromImageDataUrl('data:image/svg+xml,%3Csvg%2F%3E'), null)
  assert.equal(bytesFromImageDataUrl('data:image/png;base64,'), null)
  assert.equal(bytesFromImageDataUrl('data:image/png'), null)
})
