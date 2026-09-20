// Keeps the preload's byte caps in step with the main process's character
// caps.
//
// The two ends of each image path are capped in different units. The page
// caps the *bytes* it will read; the main process caps the *characters* of
// the data URL those bytes become, and base64 inflates by 4/3. When the page
// cap is the larger of the two, every picture past it is refused whole --
// not clipped, refused -- and the button silently keeps its initials.
//
// That mismatch shipped once, with both numbers set to 512 KiB: 512 KiB of
// bytes is about 699 Ki characters against a 512 Ki character cap, so any
// profile picture over ~384 KiB was dropped and never retried.
//
// The preload's constants are read out of its source rather than imported.
// src/preload/account.js injects them as part of a main-world string and
// requires `electron`, so it cannot be loaded under `node --test` -- the same
// reason test/channels.test.js reads its channel names as text.

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { MAX_ICON_DATA_URL_LENGTH } = require('../src/main/notificationIcon')
const { MAX_AVATAR_DATA_URL_LENGTH } = require('../src/main/accountAvatars')

const PRELOAD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src/preload/account.js'),
  'utf8'
)

/** Evaluates a `const NAME = <integer arithmetic>` declaration in the preload. */
function preloadConstant(name) {
  const match = new RegExp(`const ${name} = ([0-9 *+]+)\\n`).exec(PRELOAD_SOURCE)
  assert.ok(match, `${name} is not declared in src/preload/account.js`)
  // Only digits, spaces and * + reach here, per the pattern above.
  return Function(`"use strict"; return (${match[1]})`)()
}

/** Longest data URL that `byteCap` bytes can produce, prefix included. */
function encodedLength(byteCap) {
  const base64 = Math.ceil(byteCap / 3) * 4
  // The longest prefix either producer emits is `data:image/jpeg;base64,`.
  return base64 + 'data:image/jpeg;base64,'.length
}

test('the notification avatar byte cap fits the main process character cap', () => {
  const byteCap = preloadConstant('MAX_ICON_BYTES')
  assert.ok(
    encodedLength(byteCap) <= MAX_ICON_DATA_URL_LENGTH,
    `MAX_ICON_BYTES=${byteCap} encodes to ${encodedLength(byteCap)} characters, ` +
      `past MAX_ICON_DATA_URL_LENGTH=${MAX_ICON_DATA_URL_LENGTH}`
  )
})

test('the profile picture byte cap fits the main process character cap', () => {
  const byteCap = preloadConstant('MAX_PROFILE_PICTURE_BYTES')
  assert.ok(
    encodedLength(byteCap) <= MAX_AVATAR_DATA_URL_LENGTH,
    `MAX_PROFILE_PICTURE_BYTES=${byteCap} encodes to ${encodedLength(byteCap)} characters, ` +
      `past MAX_AVATAR_DATA_URL_LENGTH=${MAX_AVATAR_DATA_URL_LENGTH}`
  )
})

test('the preload also refuses a data URL its own byte cap let through', () => {
  // The byte-to-character relation above is the real guard; this is the
  // backstop that keeps a future drift from latching. Without it the page
  // records the picture as delivered before the main process has judged it,
  // and never retries.
  assert.match(
    PRELOAD_SOURCE,
    /if \(dataUrl\.length > MAX_PROFILE_PICTURE_DATA_URL_LENGTH\) return false/,
    'the preload no longer re-checks the encoded length before reporting'
  )
  assert.equal(preloadConstant('MAX_PROFILE_PICTURE_DATA_URL_LENGTH'), MAX_AVATAR_DATA_URL_LENGTH)
})
