// Minimal Chrome DevTools Protocol client, shared by the verification scripts.
//
// The protocol is a request/response pairing over one socket keyed by an
// incrementing id, which is little enough to not be worth a dependency. Node's
// global WebSocket is all it needs.
//
// The same client reaches two different debuggers. `--remote-debugging-port`
// exposes the renderers, and `--inspect` exposes the main process; both speak
// CDP and both list their targets over the same `/json/list` endpoint.

/**
 * @param {string} webSocketDebuggerUrl  taken from a /json/list entry
 */
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

  // Without this, an app that quits mid-run leaves every outstanding request
  // pending forever: the script hangs with no output and no exit code, which
  // is the worst possible result for something run after an upgrade.
  socket.addEventListener('close', () => {
    for (const [, resolver] of pending) {
      resolver.reject(new Error('the app closed the DevTools connection mid-run'))
    }
    pending.clear()
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

/** Every debugging target a CDP endpoint on `port` currently exposes. */
async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  return response.json()
}

/**
 * The debugging target for an account's WhatsApp Web view.
 *
 * Both verification scripts start here, so the "which target" question and
 * its diagnostic live in one place. Listing what *was* found matters: the
 * usual cause is the app not running, and the second most usual is it running
 * without --remote-debugging-port, which look identical without it.
 */
/**
 * Every WhatsApp account view.
 *
 * The `type === 'page'` filter is what makes this correct rather than nearly
 * correct: WhatsApp's service worker is registered at a web.whatsapp.com URL
 * too, and it answers neither Page nor Runtime evaluation.
 *
 * @param {Array<{type: string, url: string}>} targets
 */
function whatsAppPages(targets) {
  return targets.filter(
    (candidate) => candidate.type === 'page' && candidate.url.startsWith('https://web.whatsapp.com')
  )
}

async function findWhatsAppPage(port) {
  const targets = await listTargets(port)
  const target = whatsAppPages(targets)[0]
  if (!target) {
    throw new Error(
      `no web.whatsapp.com page on port ${port}. Targets: ` +
        (targets.map((candidate) => `${candidate.type} ${candidate.url}`).join(', ') || '(none)')
    )
  }
  return target
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Evaluates `expression` and returns its value, parsed from JSON.
 *
 * The scripts pass their probes as JSON strings rather than relying on CDP's
 * `returnByValue` object serialisation, which flattens anything it does not
 * recognise into `{}` and turns a failed assertion into a mystery.
 */
async function evaluateJson(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'evaluation threw')
  }
  return JSON.parse(result.result.value)
}

module.exports = { connect, listTargets, findWhatsAppPage, whatsAppPages, wait, evaluateJson }
