#!/usr/bin/env node
// Checks that a sender avatar survives the whole path to the notification
// daemon: WhatsApp's page -> the blob read in src/preload/account.js -> IPC ->
// src/main/notificationIcon.js -> Electron -> libnotify -> D-Bus.
//
// Every failure along that path is silent. A blob URL WhatsApp already
// revoked, a `connect-src` that stops allowing `blob:`, a data URL the main
// process rejects -- each one costs the notification its picture and nothing
// else. The notification still arrives, so nothing looks wrong.
//
// The evidence is taken off the session bus rather than from inside the app,
// for two reasons. The application carries no test hooks, the same as
// scripts/verify-keyboard-layer.js. And the bus is the only place the whole
// claim is observable: Electron does not read `notification.icon` back, so an
// in-process check could confirm the option was set and still miss libnotify
// dropping it.
//
// Needs a notification daemon on the session bus -- the same thing the feature
// itself needs. Without one there is nothing to observe and nothing to verify.
//
// Usage:
//   npm start -- --remote-debugging-port=9222
//   node scripts/verify-notification-avatar.js [--port=9222]

const { spawn } = require('node:child_process')
const readline = require('node:readline')

const { connect, findWhatsAppPage, wait, evaluateJson } = require('./lib/cdp')

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 9222)

const OVERALL_TIMEOUT_MILLISECONDS = 90000

// The colour the probe fills its avatars with, as RGBA. Checking it turns "an
// image arrived" into "this image arrived" -- without it a stale notification
// still on screen from an earlier run would pass.
const PROBE_RGBA = [0x25, 0xd3, 0x66, 0xff]

const SMALL_AVATAR_PIXELS = 96
// Deliberately past MAX_ICON_PIXELS in src/main/notificationIcon.js, and not
// square, so the cap and the aspect ratio are both tested.
const HUGE_AVATAR_WIDTH = 2000
const HUGE_AVATAR_HEIGHT = 1000
const EXPECTED_CAPPED_WIDTH = 256
const EXPECTED_CAPPED_HEIGHT = 128

// Titles are prefixed so a real message arriving mid-run is never mistaken for
// a probe, and so the assertions can find their own notification in a busy
// notification history.
const PREFIX = 'symmetria-probe'
const WARMUP_TITLE = `${PREFIX}-warmup`
const CASES = {
  small: `${PREFIX}-small-avatar`,
  huge: `${PREFIX}-huge-avatar`,
  notImage: `${PREFIX}-not-an-image`,
  none: `${PREFIX}-no-avatar`,
}

// Draws its own images into its own canvas and raises them through the page's
// `window.Notification` -- the shim from src/preload/account.js. Nothing here
// reads WhatsApp's markup, so the probe is independent of what the page shows.
const RAISE = `(async (cases, colour, small, hugeWidth, hugeHeight) => {
  const drawBlob = (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = colour
    context.fillRect(0, 0, width, height)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  const held = (window.__symmetriaProbeUrls = window.__symmetriaProbeUrls || [])
  const objectUrl = (blob) => {
    const url = URL.createObjectURL(blob)
    // Held for the life of the page rather than revoked. The shim reads the
    // blob asynchronously, and revoking under it is the exact race that costs
    // a real avatar its picture -- not the thing under test here.
    held.push(url)
    return url
  }

  const smallAvatar = objectUrl(await drawBlob(small, small))
  const hugeAvatar = objectUrl(await drawBlob(hugeWidth, hugeHeight))
  const notAnImage = objectUrl(new Blob(['not an image'], { type: 'text/plain' }))

  new window.Notification(cases.small, { body: 'probe', tag: cases.small, icon: smallAvatar })
  new window.Notification(cases.huge, { body: 'probe', tag: cases.huge, icon: hugeAvatar })
  new window.Notification(cases.notImage, { body: 'probe', tag: cases.notImage, icon: notAnImage })
  new window.Notification(cases.none, { body: 'probe', tag: cases.none })

  return JSON.stringify({ shimInstalled: window.Notification.name === 'SymmetriaNotification' })
})(${JSON.stringify(CASES)}, ${JSON.stringify(`rgb(${PROBE_RGBA.slice(0, 3).join(',')})`)},
   ${SMALL_AVATAR_PIXELS}, ${HUGE_AVATAR_WIDTH}, ${HUGE_AVATAR_HEIGHT})`

// One notification, reusing its tag so repeated warm-ups replace each other
// instead of stacking.
const RAISE_WARMUP = `(() => {
  new window.Notification(${JSON.stringify(WARMUP_TITLE)}, { body: 'probe', tag: ${JSON.stringify(WARMUP_TITLE)} })
  return JSON.stringify({ raised: true })
})()`

/**
 * Watches the session bus for Notify calls and collects them.
 *
 * `busctl --user monitor --json=short` prints one JSON object per message,
 * which is why it is preferred over dbus-monitor: no text format to parse.
 */
function watchNotifyCalls() {
  const seen = []
  const child = spawn('busctl', ['--user', 'monitor', '--json=short'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let spawnError = null
  child.on('error', (error) => {
    spawnError = error.code === 'ENOENT' ? 'busctl is not installed (it ships with systemd)' : error.message
  })

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('{')) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.interface !== 'org.freedesktop.Notifications' || message.member !== 'Notify') return

    // Notify's signature is (susssasa{sv}i): app name, replaces id, icon,
    // summary, body, actions, hints, timeout.
    const [appName, , , summary, body, , hints] = message.payload.data
    seen.push({ appName, summary: String(summary), body: String(body), hints: hints || {} })
  })

  return {
    seen,
    stop: () => child.kill('SIGTERM'),
    get error() {
      return spawnError
    },
  }
}

/** The one probe notification whose summary starts with `title`, or undefined. */
function findCase(seen, title) {
  return seen.filter((entry) => entry.summary.startsWith(title)).at(-1)
}

/**
 * The `image-data` hint as `{ width, height, rgba }`, or null when the
 * notification carried no image.
 *
 * The hint is a `(iiibiiay)` struct: width, height, row stride, whether it has
 * an alpha channel, bits per sample, channels, then the pixel bytes.
 */
function imageFrom(entry) {
  const hint = entry?.hints?.['image-data']
  if (!hint) return null
  const [width, height, , , , channels, bytes] = hint.data
  return { width, height, channels, rgba: bytes.slice(0, 4) }
}

/**
 * Raises a warm-up notification until the monitor reports seeing it.
 *
 * `busctl monitor` takes an unpredictable moment to become a monitor on the
 * bus, and a fixed sleep here would make the whole script a coin toss: the
 * probes would be raised into a monitor that was not listening yet and every
 * check would FAIL for a reason that has nothing to do with avatars.
 */
async function waitForMonitor(client, watcher, timeoutMilliseconds = 15000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (watcher.error) throw new Error(watcher.error)
    await evaluateJson(client, RAISE_WARMUP)
    await wait(400)
    if (findCase(watcher.seen, WARMUP_TITLE)) return
  }
  throw new Error(
    'no Notify call reached the session bus. Either no notification daemon owns ' +
      'org.freedesktop.Notifications, or busctl cannot monitor this bus'
  )
}

async function waitForCases(watcher, titles, timeoutMilliseconds = 20000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (titles.every((title) => findCase(watcher.seen, title))) return
    await wait(200)
  }
}

function report(label, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return passed
}

function describe(image) {
  if (!image) return 'no image-data hint'
  return `${image.width}x${image.height}, ${image.channels} channels, first pixel ${image.rgba.join(',')}`
}

async function main() {
  const pageTarget = await findWhatsAppPage(port)

  const watcher = watchNotifyCalls()
  const client = connect(pageTarget.webSocketDebuggerUrl)

  try {
    await client.ready
    await client.send('Runtime.enable')

    await waitForMonitor(client, watcher)

    const raised = await evaluateJson(client, RAISE)
    await waitForCases(watcher, Object.values(CASES))

    const small = findCase(watcher.seen, CASES.small)
    const huge = findCase(watcher.seen, CASES.huge)
    const notImage = findCase(watcher.seen, CASES.notImage)
    const none = findCase(watcher.seen, CASES.none)

    const smallImage = imageFrom(small)
    const hugeImage = imageFrom(huge)

    console.log(`\nTarget: ${pageTarget.url}\n`)

    const arrived = [small, huge, notImage, none].filter(Boolean).length
    const checks = [
      report('the Notification shim is installed', raised.shimInstalled === true),
      report(
        'every probe notification reached the notification daemon',
        arrived === 4,
        `${arrived}/4 arrived`
      ),
      report(
        'an avatar blob reaches the daemon as image data',
        Boolean(smallImage),
        describe(smallImage)
      ),
      report(
        'it is this run’s image and not a leftover',
        String(smallImage?.rgba) === String(PROBE_RGBA),
        `first pixel ${smallImage?.rgba?.join(',') ?? 'none'}, expected ${PROBE_RGBA.join(',')}`
      ),
      report(
        'an already-small avatar keeps its size',
        smallImage?.width === SMALL_AVATAR_PIXELS && smallImage?.height === SMALL_AVATAR_PIXELS,
        `${describe(smallImage)}, expected ${SMALL_AVATAR_PIXELS}x${SMALL_AVATAR_PIXELS}`
      ),
      report(
        'an oversized avatar is capped, keeping its aspect ratio',
        hugeImage?.width === EXPECTED_CAPPED_WIDTH && hugeImage?.height === EXPECTED_CAPPED_HEIGHT,
        `${describe(hugeImage)}, expected ${EXPECTED_CAPPED_WIDTH}x${EXPECTED_CAPPED_HEIGHT}`
      ),
      report(
        'an icon that is not an image is dropped, not decoded',
        notImage !== undefined && imageFrom(notImage) === null,
        describe(imageFrom(notImage))
      ),
      report(
        'a notification with no icon still carries no image',
        none !== undefined && imageFrom(none) === null,
        describe(imageFrom(none))
      ),
    ]

    const failed = checks.filter((passed) => !passed).length
    console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
    return failed === 0 ? 0 : 1
  } finally {
    client.close()
    watcher.stop()
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
