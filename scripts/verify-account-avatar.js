#!/usr/bin/env node
// Checks that an account's own profile picture survives the whole path to its
// sidebar button: WhatsApp's IndexedDB -> the reader in src/preload/account.js
// -> IPC -> src/main/accountAvatars.js -> the disk cache -> the shell
// renderer.
//
// Every step is silent. A renamed object store, a data URL the main process
// refuses, a cap that drifted out of step with the page's -- each one costs
// the button its picture and leaves the initials, which is also exactly what
// a correct app shows for an account that has no photo. Nothing looks wrong
// at any point.
//
// The picture is seeded rather than waited for, so this does not need a
// logged-in account: it writes a known image into the same object store
// WhatsApp writes, under the same key the reader looks up. What it cannot
// prove is that WhatsApp still populates that store -- that was confirmed by
// hand against a logged-in profile, and is recorded in docs/PRD.md.
//
// On a profile that has never run WhatsApp the object store may not exist
// yet, and this creates it, which bumps the database version. That is safe on
// a profile used for verification. On a logged-in profile the store already
// exists and no version changes.
//
// This refuses to run against a logged-in account, and the refusal is not a
// convenience. Seeding writes a fake id into `last-wid-md` and a fake record
// into WhatsApp's own profile-picture store, and the cleanup removes them --
// against a real account that would be overwriting and then deleting the
// identity WhatsApp keys its own session on.
//
// Run this last. It reloads each account page over the DevTools protocol, and
// the Surfingkeys UI frame does not come back from a reload driven that way,
// so scripts/verify-keyboard-layer.js reports two failures afterwards that
// have nothing to do with the app. Restart the app before running it.
//
// What this does not cover: an `avatar` path in accounts.json overriding the
// picture from WhatsApp. Checking that means editing the account config and
// restarting, which is more than a verification script should do to a
// running app.
//
// Usage:
//   npm start -- --remote-debugging-port=9222
//   node scripts/verify-account-avatar.js [--port=9222]

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { connect, listTargets, whatsAppPages, wait, evaluateJson } = require('./lib/cdp')

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 9222)

const OVERALL_TIMEOUT_MILLISECONDS = 120000

// The preload polls every 15 seconds until it first finds a picture. The
// picture is seeded before the page is reloaded, so the first poll after the
// reload finds it -- this only has to cover the reload itself.
const BUTTON_TIMEOUT_MILLISECONDS = 45000

// The account id this seeds under. Also the marker that a previous run died
// before its cleanup: the guard treats this exact value as leftover rather
// than as a real login.
const PROBE_ACCOUNT = '10000000000@c.us'
const PROBE_OWN_ID = JSON.stringify('10000000000:1@c.us')

// Unique per run, so "this run's picture" is a claim that can actually fail.
// A leftover on the button from an earlier run has a different blue channel.
const PROBE_RGB = [255, 0, (Date.now() % 200) + 55]
const REFUSED_PROBE_RGB = [0, 128, 255]

// Electron's userData directory. Derived rather than asked for: this script
// drives the app from outside and has no main process to ask. `name` in
// package.json is what Electron uses for the directory.
const USER_DATA = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  require('../package.json').name
)
const AVATAR_CACHE_DIRECTORY = path.join(USER_DATA, 'avatars')

/**
 * Writes a picture into WhatsApp's own profile-picture store, keyed by the
 * account id the reader derives from localStorage.
 *
 * `previewEurl` is a data URL rather than a pps.whatsapp.net address. The
 * reader fetches whatever it finds there, and a data URL keeps the check
 * offline -- what is under test is the path, not WhatsApp's CDN.
 */
const SEED = (rgb, filehash, mediaType) => `(async () => {
  const WID = ${JSON.stringify(PROBE_ACCOUNT)}
  localStorage.setItem('last-wid-md', ${JSON.stringify(PROBE_OWN_ID)})

  const picture = () => {
    ${
      mediaType === 'image/png'
        ? `const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    context.fillStyle = 'rgb(${rgb.join(',')})'
    context.fillRect(0, 0, 64, 64)
    return canvas.toDataURL('image/png')`
        : `return 'data:text/plain;base64,' + btoa('not a picture at all')`
    }
  }

  const open = (version) => new Promise((resolve, reject) => {
    const request = version ? indexedDB.open('model-storage', version) : indexedDB.open('model-storage')
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('profile-pic-thumb')) {
        database.createObjectStore('profile-pic-thumb', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    // WhatsApp's own page holds a connection to this database, so a version
    // change can block indefinitely. Without this the seed never settles and
    // the whole run dies on the overall timeout.
    request.onblocked = () =>
      reject(new Error('model-storage upgrade blocked by another connection'))
  })

  let database = await open()
  let createdStore = false
  if (!database.objectStoreNames.contains('profile-pic-thumb')) {
    const next = database.version + 1
    database.close()
    database = await open(next)
    createdStore = true
  }

  await new Promise((resolve, reject) => {
    const transaction = database.transaction('profile-pic-thumb', 'readwrite')
    transaction.objectStore('profile-pic-thumb').put({
      id: WID,
      tag: 'probe',
      eurl: null,
      previewEurl: picture(),
      timestamp: Math.floor(Date.now() / 1000),
      previewDirectPath: null,
      fullDirectPath: null,
      filehash: ${JSON.stringify(filehash)},
    })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })

  const stores = [...database.objectStoreNames]
  database.close()
  return JSON.stringify({ seeded: true, createdStore, storeCount: stores.length })
})()`

// Read before anything is written. A profile that has ever been logged in has
// this key, and that is the signal to stop -- unless the value is this
// script's own probe id, which means an earlier run died before its cleanup.
// Treating that as a login would lock every future run out permanently, with
// a message naming the wrong cause.
const READ_OWN_ID = `(() => JSON.stringify({ ownId: localStorage.getItem('last-wid-md') }))()`

const CLEAN_UP = `(async () => {
  localStorage.removeItem('last-wid-md')
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('model-storage')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (database.objectStoreNames.contains('profile-pic-thumb')) {
    await new Promise((resolve) => {
      const transaction = database.transaction('profile-pic-thumb', 'readwrite')
      transaction.objectStore('profile-pic-thumb').delete(${JSON.stringify(PROBE_ACCOUNT)})
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    })
  }
  database.close()
  return JSON.stringify({ cleaned: true })
})()`

// Decodes each button's picture and reports its first pixel, so a check can
// say which image is on the button rather than only that one is.
const READ_BUTTONS = `(async () => {
  const buttons = [...document.querySelectorAll('.account-button')]
  const read = async (button) => {
    const image = button.querySelector('.account-avatar')
    const label = button.getAttribute('aria-label')
    if (image.hidden || !image.getAttribute('src')) {
      return { label, showsPicture: false, initials: button.querySelector('.account-initials').textContent }
    }
    const decoded = new Image()
    await new Promise((resolve, reject) => {
      decoded.onload = resolve
      decoded.onerror = reject
      decoded.src = image.src
    })
    const canvas = document.createElement('canvas')
    canvas.width = decoded.naturalWidth
    canvas.height = decoded.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(decoded, 0, 0)
    const pixel = context.getImageData(0, 0, 1, 1).data
    return {
      label,
      showsPicture: true,
      size: [decoded.naturalWidth, decoded.naturalHeight],
      rgb: [pixel[0], pixel[1], pixel[2]],
    }
  }
  return JSON.stringify(await Promise.all(buttons.map(read)))
})()`

function report(label, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return passed
}

const showsColour = (buttons, rgb) =>
  buttons.some((button) => button.showsPicture && String(button.rgb) === String(rgb))

async function waitForColour(shell, rgb, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds
  let buttons = []
  while (Date.now() < deadline) {
    try {
      buttons = await evaluateJson(shell, READ_BUTTONS)
      if (showsColour(buttons, rgb)) return buttons
    } catch {
      // The shell renderer is not reloaded, so this only happens while the
      // account page is mid-reload and the picture has not arrived yet.
    }
    await wait(1000)
  }
  return buttons
}

/** Freshly opened for each round: reloading destroys the page's context. */
async function openAccountPages(targets) {
  const pages = whatsAppPages(targets)
  const clients = []
  for (const page of pages) {
    const client = connect(page.webSocketDebuggerUrl)
    await client.ready
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    clients.push(client)
  }
  return clients
}

async function seedAndReload(targets, rgb, filehash, mediaType) {
  const clients = await openAccountPages(targets)
  try {
    const seeded = []
    for (const client of clients) {
      seeded.push(await evaluateJson(client, SEED(rgb, filehash, mediaType)))
    }
    // The reader polls slowly once it has found a picture, so a reload is what
    // makes this check repeatable rather than a one-shot within five minutes.
    for (const client of clients) await client.send('Page.reload')
    return seeded
  } finally {
    for (const client of clients) client.close()
  }
}

async function main() {
  const targets = await listTargets(port)
  const shellTarget = targets.find((target) => target.url.endsWith('src/renderer/index.html'))
  if (!shellTarget) throw new Error('the app shell renderer is not among the debug targets')

  const accountCount = whatsAppPages(targets).length
  if (accountCount === 0) throw new Error('no WhatsApp account view is loaded')

  // Refuse before writing anything. See the note at the top of this file: on
  // a logged-in profile the seed would overwrite the account's own id and the
  // cleanup would then delete it.
  const guardClients = await openAccountPages(targets)
  try {
    for (const client of guardClients) {
      const { ownId } = await evaluateJson(client, READ_OWN_ID)
      if (ownId === null || ownId === PROBE_OWN_ID) continue
      throw new Error(
        'this profile is logged in to WhatsApp. This check seeds a fake account id and a ' +
          'fake picture into WhatsApp\'s own store, and removing them again would take the ' +
          'real account id with it. Run it against a profile that is not logged in.'
      )
    }
  } finally {
    for (const client of guardClients) client.close()
  }

  const shell = connect(shellTarget.webSocketDebuggerUrl)
  await shell.ready
  await shell.send('Runtime.enable')

  // Name plus mtime, not just name: from the second run onwards the
  // directory is never empty, and a presence check would pass without the
  // app having written anything at all.
  const cacheFingerprint = () => {
    if (!fs.existsSync(AVATAR_CACHE_DIRECTORY)) return new Map()
    return new Map(
      fs.readdirSync(AVATAR_CACHE_DIRECTORY).map((name) => {
        const { mtimeMs, size } = fs.statSync(path.join(AVATAR_CACHE_DIRECTORY, name))
        return [name, `${mtimeMs}:${size}`]
      })
    )
  }
  const cachedBefore = cacheFingerprint()

  try {
    console.log(`\nAccount views: ${accountCount}\nAvatar cache: ${AVATAR_CACHE_DIRECTORY}\n`)

    const seeded = await seedAndReload(targets, PROBE_RGB, 'probe-hash-1', 'image/png')
    const afterSeed = await waitForColour(shell, PROBE_RGB, BUTTON_TIMEOUT_MILLISECONDS)

    const cachedAfter = cacheFingerprint()
    const newlyCached = [...cachedAfter]
      .filter(([name, stamp]) => cachedBefore.get(name) !== stamp)
      .map(([name]) => name)

    // A picture that is not a picture must be refused by the main process.
    // The button keeps the one it already has rather than going blank.
    await seedAndReload(await listTargets(port), REFUSED_PROBE_RGB, 'probe-hash-2', 'text/plain')
    // Returns the moment the refused colour appears -- which is the failure
    // this asserts against -- and otherwise runs out the clock. A bare sleep
    // could not fail early, and hid why it was waiting.
    const afterRefused = await waitForColour(shell, REFUSED_PROBE_RGB, BUTTON_TIMEOUT_MILLISECONDS)

    const describe = (buttons) =>
      buttons
        .map((b) => (b.showsPicture ? `${b.label}=${b.rgb.join(',')}` : `${b.label}=initials`))
        .join('  ')

    const checks = [
      report(
        'the picture reaches WhatsApp’s own profile-picture store',
        seeded.every((s) => s.seeded === true),
        seeded.map((s) => `${s.storeCount} stores${s.createdStore ? ', created' : ''}`).join('; ')
      ),
      report(
        'the account’s picture reaches its sidebar button',
        showsColour(afterSeed, PROBE_RGB),
        describe(afterSeed)
      ),
      report(
        'every button showing a picture shows this run’s, not a leftover',
        afterSeed.every((button) => !button.showsPicture || String(button.rgb) === String(PROBE_RGB)),
        `this run is ${PROBE_RGB.join(',')} — ${describe(afterSeed)}`
      ),
      report(
        'the picture is cached to disk for the next launch',
        newlyCached.length > 0,
        newlyCached.length > 0
          ? `wrote ${newlyCached.join(', ')}`
          : `nothing new in ${AVATAR_CACHE_DIRECTORY}`
      ),
      report(
        'a reported picture that is not an image is refused',
        !showsColour(afterRefused, REFUSED_PROBE_RGB),
        describe(afterRefused)
      ),
      report(
        'refusing it leaves the previous picture in place',
        showsColour(afterRefused, PROBE_RGB),
        describe(afterRefused)
      ),
    ]

    const failed = checks.filter((passed) => !passed).length
    console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
    return failed === 0 ? 0 : 1
  } finally {
    try {
      const clients = await openAccountPages(await listTargets(port))
      for (const client of clients) {
        await evaluateJson(client, CLEAN_UP)
        client.close()
      }
    } catch (error) {
      console.error(`could not remove the seeded picture: ${error.message}`)
    }
    shell.close()
  }
}

Promise.race([
  main(),
  new Promise((_resolve, reject) =>
    setTimeout(
      () => reject(new Error(`gave up after ${OVERALL_TIMEOUT_MILLISECONDS / 1000}s`)),
      OVERALL_TIMEOUT_MILLISECONDS
    ).unref()
  ),
])
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`verification failed: ${error.message}`)
    process.exit(2)
  })
