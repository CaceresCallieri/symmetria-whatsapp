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

// A source list that contains 'none' may not contain anything else: per CSP3
// that combination is invalid, and Chromium responds by warning and ignoring
// the directive. Appending the extension scheme to `frame-src 'none'` would
// therefore produce exactly the silent non-application this module exists to
// prevent, so 'none' is dropped whenever another source joins it.
const NONE_SOURCE = "'none'"

/** Rewrites one CSP policy so extension frames are allowed. */
function allowOneExtensionFramePolicy(policy) {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)

  const present = new Set(directives.map((directive) => directive.split(/\s+/)[0].toLowerCase()))

  const withExtensionScheme = (name, sources) => {
    const kept = sources.filter((source) => source !== NONE_SOURCE)
    return [name, ...kept, EXTENSION_SCHEME].join(' ')
  }

  const patched = directives.map((directive) => {
    const [name, ...sources] = directive.split(/\s+/)
    if (!FRAME_DIRECTIVES.includes(name.toLowerCase())) return directive
    if (sources.includes(EXTENSION_SCHEME)) return directive
    return withExtensionScheme(name, sources)
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
      const sources = defaultDirective.split(/\s+/).slice(1)
      patched.push(withExtensionScheme('frame-src', sources))
    }
  }

  return patched.join('; ')
}

/**
 * Rewrites a Content-Security-Policy header value.
 *
 * One header value may carry several comma-separated policies, each of which
 * is enforced independently. Chromium normally hands Electron one policy per
 * array entry so this rarely matters, but splitting on ';' alone would parse
 * `default-src 'self', frame-src 'none'` as a single default-src directive and
 * silently miss the frame-src -- defensive, because the failure would be quiet.
 */
function allowExtensionFrames(headerValue) {
  return headerValue
    .split(',')
    .map((policy) => allowOneExtensionFramePolicy(policy))
    .join(', ')
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
    // Every response in the session passes through here, so a thrown
    // exception would leave `callback` uncalled and hang that request
    // forever -- a stalled page with no error anywhere. Any failure must
    // degrade to "leave the headers exactly as they arrived".
    try {
      const headers = details.responseHeaders
      if (!headers) return callback({})

      let changed = false
      const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
      const isExtensionResponse = details.url.startsWith('chrome-extension://')

      // Only documents can frame anything, and the extension's own pages
      // gain nothing from a weaker policy -- narrowing to this case keeps
      // the relaxation as small as the module claims it is.
      if (isDocument && !isExtensionResponse) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() !== 'content-security-policy') continue
          headers[name] = headers[name].map((value) => {
            const patched = allowExtensionFrames(value)
            if (patched !== value) changed = true
            return patched
          })
        }
      }

      // Scoped to extension documents being embedded. A subresource does not
      // need this, and a WhatsApp response must never receive it.
      if (isExtensionResponse && details.resourceType === 'subFrame') {
        markEmbeddable(headers)
        changed = true
      }

      callback(changed ? { responseHeaders: headers } : {})
    } catch (error) {
      console.error(`[frame-policy] header rewrite failed for ${details.url?.slice(0, 120)}:`, error)
      callback({})
    }
  })
}

module.exports = { allowExtensionFramesInSession, allowExtensionFrames }
