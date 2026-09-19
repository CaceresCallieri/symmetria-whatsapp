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

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 9222)
const screenshotPath = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || null
const hintKey = process.argv.find((a) => a.startsWith('--key='))?.split('=')[1] || 'f'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findWhatsAppTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await response.json()
  const target = targets.find(
    (candidate) => candidate.type === 'page' && candidate.url.startsWith('https://web.whatsapp.com')
  )
  if (!target) {
    throw new Error(
      `no web.whatsapp.com page on port ${port}. Targets: ` +
        targets.map((candidate) => `${candidate.type} ${candidate.url}`).join(', ')
    )
  }
  return target
}

// Minimal CDP client. The protocol is a request/response pairing over one
// socket keyed by an incrementing id, which is little enough to not be worth a
// dependency.
function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const resolver = pending.get(message.id)
    if (!resolver) return
    pending.delete(message.id)
    message.error ? resolver.reject(new Error(message.error.message)) : resolver.resolve(message.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })

  return {
    ready,
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

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

async function evaluate(client) {
  const result = await client.send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  return JSON.parse(result.result.value)
}

async function pressKey(client, key) {
  const base = { key, code: `Key${key.toUpperCase()}`, text: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await client.send('Input.dispatchKeyEvent', { type: 'char', ...base })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await wait(1200)
}

// Hint mode toggles, so a previous run that left hints on screen would make
// this one read backwards: hints present before the key, and none after it.
// Escape returns Surfingkeys to normal mode whatever state it was left in.
async function resetToNormalMode(client) {
  const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...escape })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...escape })
  await wait(600)
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
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  return targets
    .filter((candidate) => candidate.type === 'iframe' && candidate.url.startsWith('chrome-extension://'))
    .map((candidate) => candidate.url)
}

async function main() {
  const target = await findWhatsAppTarget()
  const client = connect(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')

  await resetToNormalMode(client)
  const before = await evaluate(client)
  await pressKey(client, hintKey)
  const after = await evaluate(client)
  const liveFrames = await findLiveExtensionFrames()

  console.log(`\nTarget: ${after.url}\n`)

  const checks = [
    report('WhatsApp Web loaded (no browser-unsupported wall)', after.title === 'WhatsApp', `title=${JSON.stringify(after.title)}`),
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

main().catch((error) => {
  console.error(`verification failed: ${error.message}`)
  process.exit(2)
})
