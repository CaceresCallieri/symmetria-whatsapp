#!/usr/bin/env node
// Checks that the keyboard layer is actually alive in the running app.
//
// The failures this catches are all silent ones: Surfingkeys' content script
// not attaching, WhatsApp serving the browser-unsupported wall because a user
// agent regressed, or the extension UI frame being refused by a CSP that
// changed shape. None of them crash the app; it just quietly stops responding
// to keys. Run this after upgrading Electron, Surfingkeys, or
// electron-chrome-extensions.
//
// It drives the app over the Chrome DevTools Protocol rather than from inside,
// so the application code carries no test hooks.
//
// Usage:
//   npm start -- --remote-debugging-port=9222
//   node scripts/verify-keyboard-layer.js [--port=9222] [--out=/tmp/shot.png]

const fs = require('node:fs')

const { connect, listTargets, findWhatsAppPage, wait, evaluateJson } = require('./lib/cdp')

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 9222)
const screenshotPath = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || null
const hintKey = process.argv.find((a) => a.startsWith('--key='))?.split('=')[1] || 'f'

const PROBE = `(() => {
  const hosts = Array.from(document.querySelectorAll('.surfingkeys_hints_host'))
  const hints = hosts.flatMap((host) =>
    host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll('div'))
      .map((node) => node.textContent.trim()).filter(Boolean) : []
  )
  return JSON.stringify({
    url: location.href,
    title: document.title,
    hintCount: hints.length,
    hints: hints.slice(0, 12),
    // Surfingkeys hides its UI frame inside an open shadow root on a host div,
    // so a plain document query never finds it. Both the hint overlay and the
    // omnibar frame are reached by walking every shadow root in the page.
    extensionFrames: (() => {
      const frames = []
      const visit = (root) => {
        for (const frame of root.querySelectorAll('iframe')) {
          if (frame.src.startsWith('chrome-extension://')) frames.push(frame.src)
        }
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) visit(element.shadowRoot)
        }
      }
      visit(document)
      return frames
    })(),
    notificationPatched: window.Notification && window.Notification.name === 'SymmetriaNotification',
    notificationPermission: window.Notification ? window.Notification.permission : null,
  })
})()`

const evaluate = (client) => evaluateJson(client, PROBE)

async function pressKey(client, key) {
  const base = { key, code: `Key${key.toUpperCase()}`, text: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await client.send('Input.dispatchKeyEvent', { type: 'char', ...base })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

/**
 * Waits for `predicate` to hold, re-probing until a deadline.
 *
 * A fixed sleep after each keypress was the previous approach, and it made
 * this script a coin toss on a loaded machine: too short and hint mode had
 * not rendered yet, producing a FAIL indistinguishable from a real
 * regression. Polling makes a pass fast and a failure deterministic.
 */
async function waitFor(client, predicate, timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds
  let state = await evaluate(client)
  while (!predicate(state) && Date.now() < deadline) {
    await wait(100)
    state = await evaluate(client)
  }
  return state
}

// Hint mode toggles, so a previous run that left hints on screen would make
// this one read backwards: hints present before the key, and none after it.
// Escape returns Surfingkeys to normal mode whatever state it was left in.
async function resetToNormalMode(client) {
  const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...escape })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...escape })
  await waitFor(client, (state) => state.hintCount === 0, 3000)
}

function report(label, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return passed
}

// An <iframe> element in the DOM proves nothing: a frame refused by CSP leaves
// the element behind with an empty document. Chromium only lists a frame as its
// own debugging target once it has a real document, so asking the target list
// is what distinguishes "rendered" from "blocked".
async function findLiveExtensionFrames() {
  const targets = await listTargets(port)
  return targets
    .filter((candidate) => candidate.type === 'iframe' && candidate.url.startsWith('chrome-extension://'))
    .map((candidate) => candidate.url)
}

async function main() {
  const target = await findWhatsAppPage(port)
  const client = connect(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')

  await resetToNormalMode(client)
  const before = await evaluate(client)
  await pressKey(client, hintKey)
  const after = await waitFor(client, (state) => state.hintCount > 0)
  const liveFrames = await findLiveExtensionFrames()

  console.log(`\nTarget: ${after.url}\n`)

  const checks = [
    // WhatsApp prefixes the unread count into the title ('(3) WhatsApp'),
    // which the unread badge in src/preload/account.js depends on. An exact
    // match would fail this check for anyone with unread messages -- a false
    // FAIL on the most important assertion in the script.
    report('WhatsApp Web loaded (no browser-unsupported wall)', /^(\(\d+\) )?WhatsApp$/.test(after.title), `title=${JSON.stringify(after.title)}`),
    report('no hints before the key', before.hintCount === 0, `${before.hintCount} hints`),
    report(`hint mode engages on "${hintKey}"`, after.hintCount > 0, `${after.hintCount} hints: ${after.hints.join(' ')}`),
    report('Surfingkeys UI frame present in the page', after.extensionFrames.length > 0, after.extensionFrames.join(', ') || 'no chrome-extension:// iframe in the page'),
    report('Surfingkeys UI frame actually rendered (not CSP-blocked)', liveFrames.length > 0, liveFrames.length ? `${liveFrames.length} live frame(s)` : 'the iframe element exists but holds no document'),
    report('Notification is routed to the main process', after.notificationPatched === true, `constructor=${after.notificationPatched}`),
    report('notification permission reported as granted', after.notificationPermission === 'granted', `permission=${after.notificationPermission}`),
  ]

  if (screenshotPath) {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))
    console.log(`\nScreenshot: ${screenshotPath}`)
  }

  client.close()

  const failed = checks.filter((passed) => !passed).length
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  process.exit(failed === 0 ? 0 : 1)
}

const OVERALL_TIMEOUT_MILLISECONDS = 60000

Promise.race([
  main(),
  new Promise((_resolve, reject) =>
    setTimeout(
      () => reject(new Error(`gave up after ${OVERALL_TIMEOUT_MILLISECONDS / 1000}s`)),
      OVERALL_TIMEOUT_MILLISECONDS
    ).unref()
  ),
]).catch((error) => {
  console.error(`verification failed: ${error.message}`)
  process.exit(2)
})
