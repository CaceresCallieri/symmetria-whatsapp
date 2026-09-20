// Guards the path handling for an account's sidebar picture.
//
// `avatar` is written by hand in accounts.json, so every way of getting it
// wrong ends in the same place: the button shows initials and nothing says
// why. These tests cover the rejections that happen before any image decode,
// and assert that each one explains itself on the console -- the warning is
// the only thing that turns a silent fallback into a findable mistake.
//
// The decode itself is not covered. It needs a real NativeImage, and Electron
// is an Arch system package rather than a node_modules dependency, so
// `node --test` has no Electron runtime.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  avatarDataUrlFrom,
  resolveAvatarPath,
  MAX_AVATAR_FILE_BYTES,
} = require('../src/main/accountAvatars')

/** Runs `body` with console.warn captured, and returns what it wrote. */
function warningsFrom(body) {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    body()
  } finally {
    console.warn = original
  }
  return warnings
}

test('expands a leading ~ to the home directory', () => {
  assert.equal(resolveAvatarPath('~'), os.homedir())
  assert.equal(resolveAvatarPath('~/pictures/me.png'), path.join(os.homedir(), 'pictures/me.png'))
})

test('keeps an absolute path as it is', () => {
  assert.equal(resolveAvatarPath('/var/lib/pictures/me.png'), '/var/lib/pictures/me.png')
})

test('refuses a relative path rather than resolving it', () => {
  // It would resolve against the working directory, so the same config would
  // find the picture when started from a terminal and miss it from a
  // launcher. A null here becomes a warning naming the file.
  assert.equal(resolveAvatarPath('me.png'), null)
  assert.equal(resolveAvatarPath('./me.png'), null)
  assert.equal(resolveAvatarPath('../me.png'), null)
  // `~other` is another user's home to a shell, but nothing expands it here,
  // so it must not be treated as absolute either.
  assert.equal(resolveAvatarPath('~other/me.png'), null)
})

test('treats a missing or non-string avatar as simply having no picture', () => {
  // The field is optional, so these are the ordinary case and must stay
  // quiet. A warning here would fire for every account that has no picture.
  const warnings = warningsFrom(() => {
    for (const value of [undefined, null, '', 0, 42, true, {}, []]) {
      assert.equal(avatarDataUrlFrom(value, 'personal'), null, `accepted ${JSON.stringify(value)}`)
    }
  })
  assert.deepEqual(warnings, [])
})

test('warns and falls back when the path is relative', () => {
  const warnings = warningsFrom(() => {
    assert.equal(avatarDataUrlFrom('me.png', 'work'), null)
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /work/)
  assert.match(warnings[0], /me\.png/)
})

test('warns and falls back when the file is not there', () => {
  const missing = path.join(os.tmpdir(), `symmetria-no-such-avatar-${process.pid}.png`)
  const warnings = warningsFrom(() => {
    assert.equal(avatarDataUrlFrom(missing, 'work'), null)
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /cannot read/)
})

test('warns and falls back when the path is a directory', () => {
  // statSync succeeds on a directory, so without the isFile check this would
  // reach readFileSync and fail with an EISDIR nobody expects.
  const warnings = warningsFrom(() => {
    assert.equal(avatarDataUrlFrom(os.tmpdir(), 'work'), null)
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /not a file/)
})

test('warns and falls back when the file is past the size limit', (t) => {
  const oversized = path.join(os.tmpdir(), `symmetria-oversized-avatar-${process.pid}.png`)
  // Sparse, so this costs no disk: only the reported size matters.
  fs.writeFileSync(oversized, '')
  fs.truncateSync(oversized, MAX_AVATAR_FILE_BYTES + 1)
  t.after(() => fs.rmSync(oversized, { force: true }))

  const warnings = warningsFrom(() => {
    assert.equal(avatarDataUrlFrom(oversized, 'work'), null)
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /past the/)
})
