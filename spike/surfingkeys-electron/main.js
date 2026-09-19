// Throwaway spike. Question it answers: does the Surfingkeys extension load
// inside Electron and does its hint mode engage on a real page, in particular
// on WhatsApp Web?
//
// The harness is non-interactive on purpose. It loads a URL, waits for the page
// to settle, presses a key, inspects the DOM Surfingkeys creates, writes a
// screenshot, prints a JSON report and exits. Run it under Xvfb.
//
// Usage: electron42 . --url=https://web.whatsapp.com --key=f --out=/tmp/shot.png

const path = require('node:path')
const fs = require('node:fs')
const { app, session, BrowserWindow } = require('electron')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')

const EXTENSION_PATH = path.join(__dirname, 'surfingkeys-ext')

// Surfingkeys builds its hint overlay into a host div with this class, and
// attaches an open shadow root to it. An open root is what lets the probe below
// count the hints from the main world -- the content script itself runs in an
// isolated world we cannot reach from executeJavaScript.
const HINTS_HOST_SELECTOR = '.surfingkeys_hints_host'

function readArgument(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3) : fallback
}

const targetUrl = readArgument('url', 'https://web.whatsapp.com')
const hintKey = readArgument('key', 'f')
const screenshotPath = readArgument('out', '/tmp/surfingkeys-spike.png')
const settleMilliseconds = Number(readArgument('settle', '12000'))

// WhatsApp Web sniffs the user agent and refuses to run when it sees the
// `Electron/<version>` token, showing an "update Google Chrome" wall instead.
// Presenting the plain Chrome string for the Chromium actually embedded in this
// Electron build is what every Electron WhatsApp wrapper does.
const CHROME_USER_AGENT =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`

const userAgent = readArgument('ua', '') === 'chrome' ? CHROME_USER_AGENT : null

const report = {
  target: targetUrl,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  extension: null,
  serviceWorkerMessages: [],
  pageConsoleErrors: [],
  probeBeforeKey: null,
  probeAfterKey: null,
  screenshot: null,
  userAgent: null,
  failures: [],
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// Runs in the page's main world. Reports every trace Surfingkeys leaves in the
// DOM, so a partial load is distinguishable from no load at all.
//
// This probe is the throwaway original and has already drifted: it searches
// only the light DOM, so it cannot see the Surfingkeys UI frame, which lives
// inside a shadow root. `scripts/verify-keyboard-layer.js` holds the
// maintained version -- prefer it, and treat this one as a record of the
// spike rather than a tool.
const PROBE_SCRIPT = `(() => {
  const hostSelector = ${JSON.stringify(HINTS_HOST_SELECTOR)}

  const hintHosts = Array.from(document.querySelectorAll(hostSelector))
  const hintLabels = hintHosts.flatMap((host) =>
    host.shadowRoot
      ? Array.from(host.shadowRoot.querySelectorAll('div'))
          .map((node) => node.textContent.trim())
          .filter(Boolean)
      : []
  )

  const extensionFrames = Array.from(document.querySelectorAll('iframe'))
    .map((frame) => frame.src)
    .filter((src) => src.startsWith('chrome-extension://'))

  const markedElements = Array.from(document.querySelectorAll('*'))
    .filter((node) => {
      const id = typeof node.id === 'string' ? node.id : ''
      const className = typeof node.className === 'string' ? node.className : ''
      return id.startsWith('sk_') || className.includes('surfingkeys')
    })
    .map((node) => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\\s+/).join('.') : ''))

  return {
    url: location.href,
    title: document.title,
    hintHostCount: hintHosts.length,
    hintCount: hintLabels.length,
    hintSample: hintLabels.slice(0, 12),
    extensionFrames,
    markedElements: markedElements.slice(0, 20),
    clickableCount: document.querySelectorAll('a, button, [role="button"], [role="listitem"], input, textarea, [contenteditable="true"]').length,
  }
})()`

// Surfingkeys listens on keydown in the content script's isolated world, so the
// key has to come through Chromium's real input pipeline rather than a
// synthesised DOM event.
async function pressKey(webContents, key) {
  webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
  webContents.sendInputEvent({ type: 'char', keyCode: key })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
  await wait(1500)
}

async function run() {
  const spikeSession = session.fromPartition('persist:surfingkeys-spike')

  if (userAgent) {
    spikeSession.setUserAgent(userAgent)
    report.userAgent = userAgent
  }

  // GPL-3.0 is the licence this repository already carries, so it is the
  // correct declaration for electron-chrome-extensions' dual-licence check.
  new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: spikeSession,
    createTab: async () => {
      throw new Error('spike is single-tab')
    },
    selectTab: () => {},
    removeTab: () => {},
    createWindow: async () => {
      throw new Error('spike is single-window')
    },
    removeWindow: () => {},
  })

  spikeSession.serviceWorkers.on('console-message', (_event, details) => {
    report.serviceWorkerMessages.push(`[${details.level}] ${details.message}`)
  })

  // WhatsApp Web needs the microphone for voice notes. Granting it here also
  // confirms the permission handler is the only thing standing between Electron
  // and a working recorder.
  spikeSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
  })

  try {
    const extension = await spikeSession.extensions.loadExtension(EXTENSION_PATH)
    report.extension = { id: extension.id, name: extension.name, version: extension.version }
  } catch (error) {
    report.failures.push(`loadExtension: ${error.message}`)
    return
  }

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      session: spikeSession,
      sandbox: true,
      contextIsolation: true,
    },
  })

  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) report.pageConsoleErrors.push(message)
  })

  try {
    await window.loadURL(targetUrl)
  } catch (error) {
    report.failures.push(`loadURL: ${error.message}`)
  }

  // WhatsApp Web boots a large React application after the document loads, so
  // the probe has to wait for the app shell rather than the load event.
  await wait(settleMilliseconds)

  report.probeBeforeKey = await window.webContents.executeJavaScript(PROBE_SCRIPT)

  window.focus()
  window.webContents.focus()
  await pressKey(window.webContents, hintKey)

  report.probeAfterKey = await window.webContents.executeJavaScript(PROBE_SCRIPT)

  try {
    const image = await window.webContents.capturePage()
    fs.writeFileSync(screenshotPath, image.toPNG())
    report.screenshot = screenshotPath
  } catch (error) {
    report.failures.push(`capturePage: ${error.message}`)
  }
}

app.whenReady().then(async () => {
  try {
    await run()
  } catch (error) {
    report.failures.push(`unhandled: ${error.stack}`)
  }
  console.log('\n===SPIKE_REPORT_START===')
  console.log(JSON.stringify(report, null, 2))
  console.log('===SPIKE_REPORT_END===')
  app.exit(report.failures.length > 0 ? 1 : 0)
})
