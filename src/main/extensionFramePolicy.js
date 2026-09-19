// Lets the Surfingkeys UI frame render on top of WhatsApp Web.
//
// Surfingkeys draws its omnibar, status line and hint feedback in an iframe
// served from `chrome-extension://`. WhatsApp Web refuses that iframe twice
// over, and both refusals have to be lifted or the frame never renders. Hints
// still appear either way, because they are injected into the page's own DOM
// behind a shadow root -- so the symptom is not an obvious breakage but every
// feature needing the UI frame (`/` search, `:` commands, the key-sequence
// display) silently doing nothing.
//
// Real Chrome hits neither problem, because it exempts extension frames from
// both gates. Electron implements no such exemption, so it is applied here.
//
// Gate 1 -- Content-Security-Policy. WhatsApp's `frame-src` lists its own
// origins and nothing else, so `chrome-extension:` is added to the frame
// directives.
//
// Gate 2 -- cross-origin isolation. WhatsApp sends
// `Cross-Origin-Embedder-Policy: require-corp`, which additionally demands that
// every embedded document opt in to being embedded. An extension page sends no
// such opt-in, so it is refused with ERR_BLOCKED_BY_RESPONSE even once the CSP
// allows it. The opt-in headers are therefore added to the extension frame's
// own response.
//
// Both relaxations are deliberately the smallest ones that work. Only frame
// directives are touched and only the `chrome-extension:` scheme is added, so
// the page still cannot frame any remote origin it could not frame before; and
// the isolation opt-in is written onto extension responses only, never onto
// WhatsApp's own, so WhatsApp keeps its cross-origin isolation intact.

const FRAME_DIRECTIVES = ['frame-src', 'child-src']
const EXTENSION_SCHEME = 'chrome-extension:'

/** Rewrites one CSP header value so extension frames are allowed. */
function allowExtensionFrames(policy) {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)

  const present = new Set(directives.map((directive) => directive.split(/\s+/)[0].toLowerCase()))

  const patched = directives.map((directive) => {
    const [name] = directive.split(/\s+/)
    if (!FRAME_DIRECTIVES.includes(name.toLowerCase())) return directive
    if (directive.includes(EXTENSION_SCHEME)) return directive
    return `${directive} ${EXTENSION_SCHEME}`
  })

  // With no frame-src of its own, the page falls back to default-src, which
  // also does not permit extension frames. Add an explicit frame-src that
  // reproduces the fallback and then widens it, rather than widening
  // default-src and loosening scripts and everything else along with it.
  if (!present.has('frame-src') && !present.has('child-src')) {
    const defaultDirective = directives.find(
      (directive) => directive.split(/\s+/)[0].toLowerCase() === 'default-src'
    )
    if (defaultDirective) {
      const sources = defaultDirective.split(/\s+/).slice(1).join(' ')
      patched.push(`frame-src ${sources} ${EXTENSION_SCHEME}`.trim())
    }
  }

  return patched.join('; ')
}

/**
 * Adds the headers an extension page needs to be embeddable inside a
 * cross-origin-isolated document.
 *
 * `Cross-Origin-Resource-Policy` alone is not enough for a nested document:
 * under `require-corp` the embedded document has to carry the embedder policy
 * itself, so both headers go on. The extension page only ever loads its own
 * same-origin resources, which satisfy `require-corp` without further work.
 */
function markEmbeddable(headers) {
  for (const name of Object.keys(headers)) {
    const lowered = name.toLowerCase()
    if (lowered === 'cross-origin-resource-policy' || lowered === 'cross-origin-embedder-policy') {
      delete headers[name]
    }
  }
  headers['cross-origin-resource-policy'] = ['cross-origin']
  headers['cross-origin-embedder-policy'] = ['require-corp']
}

/**
 * Applies both relaxations to a session.
 *
 * Report-only policies are left alone on purpose: they block nothing, so
 * rewriting them would only hide a genuine signal from WhatsApp's own
 * reporting.
 */
function allowExtensionFramesInSession(accountSession) {
  accountSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders
    if (!headers) return callback({})

    let changed = false

    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() !== 'content-security-policy') continue
      headers[name] = headers[name].map((value) => {
        const patched = allowExtensionFrames(value)
        if (patched !== value) changed = true
        return patched
      })
    }

    // Scoped to extension documents being embedded. A subresource does not
    // need this, and a WhatsApp response must never receive it.
    if (details.url.startsWith('chrome-extension://') && details.resourceType === 'subFrame') {
      markEmbeddable(headers)
      changed = true
    }

    callback(changed ? { responseHeaders: headers } : {})
  })
}

module.exports = { allowExtensionFramesInSession, allowExtensionFrames }
