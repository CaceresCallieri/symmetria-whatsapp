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
  accountsWithAvatars,
  avatarDataUrlFrom,
  reportedAvatarImageFrom,
  resolveAvatarPath,
  MAX_AVATAR_FILE_BYTES,
  MAX_AVATAR_DATA_URL_LENGTH,
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

// --- reportedAvatarImageFrom ----------------------------------------------
//
// The picture an account's page reports over IPC. Only the rejections are
// covered: anything this accepts goes on to build a NativeImage, and
// `node --test` has no Electron runtime to build one in.

test('refuses a reported picture that is not an inert image data URL', () => {
  for (const source of [
    // The page must convert the picture itself. A URL here would be an
    // address a renderer chose for the privileged process to fetch.
    'https://pps.whatsapp.net/v/t61/avatar.jpg',
    'blob:https://web.whatsapp.com/a-uuid',
    'file:///etc/shadow',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:,hello',
    undefined,
    null,
    '',
    42,
    {},
  ]) {
    assert.equal(reportedAvatarImageFrom(source), null, `accepted ${JSON.stringify(source)}`)
  }
})

test('refuses a reported picture past the size cap', () => {
  // Far tighter than the cap on a file the operator named: this one is built
  // by WhatsApp's renderer, and the thumbnail it stores is a few kilobytes.
  const oversized = `data:image/png;base64,${'A'.repeat(MAX_AVATAR_DATA_URL_LENGTH)}`
  assert.equal(reportedAvatarImageFrom(oversized), null)
})

// --- accountsWithAvatars --------------------------------------------------

test('renames the configured path to the picture the renderer receives', () => {
  // The rename is the thing that stops a filesystem path reaching an
  // <img src>, where it would silently show nothing: the shell renderer's
  // Content-Security-Policy allows `img-src 'self' data:` and no `file:`.
  let accounts
  warningsFrom(() => {
    accounts = accountsWithAvatars([
      { id: 'work', name: 'Work', color: '#53bdeb', avatar: '/nonexistent-avatar.png' },
    ])
  })

  assert.equal(accounts.length, 1)
  assert.ok(!('avatar' in accounts[0]), 'the path must not reach the renderer')
  assert.ok('avatarDataUrl' in accounts[0], 'the renderer needs an avatarDataUrl key')
  assert.deepEqual(
    { id: accounts[0].id, name: accounts[0].name, color: accounts[0].color },
    { id: 'work', name: 'Work', color: '#53bdeb' }
  )
})

test('an account with no picture from either source still has the key', () => {
  // The renderer reads account.avatarDataUrl unconditionally; an absent key
  // and a null both fall back to the initials, but only one shape is worth
  // relying on.
  let accounts
  warningsFrom(() => {
    accounts = accountsWithAvatars([{ id: 'personal', name: 'Personal', color: '#25d366' }])
  })
  assert.ok('avatarDataUrl' in accounts[0])
  assert.equal(accounts[0].avatarDataUrl, null)
})
