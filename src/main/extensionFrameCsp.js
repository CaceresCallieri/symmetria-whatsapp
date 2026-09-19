// Lets the Surfingkeys UI frame render on top of WhatsApp Web.
//
// Surfingkeys draws its omnibar, status line and hint feedback in an iframe
// served from `chrome-extension://`. WhatsApp Web sends a Content-Security-
// Policy whose `frame-src` lists its own origins and nothing else, so that
// iframe is refused with ERR_BLOCKED_BY_RESPONSE. Hints still appear, because
// they are injected into the page's own DOM behind a shadow root, but every
// Surfingkeys feature that needs its UI frame -- `/` search, `:` commands, the
// key-sequence display -- silently does nothing.
//
// Real Chrome does not have this problem: it exempts extension frames from the
// page's CSP. Electron implements no such exemption, so the exemption has to be
// applied by hand, by adding `chrome-extension:` to the frame directives on the
// way in.
//
// The relaxation is deliberately the smallest one that works. Only the frame
// directives are touched, and only the `chrome-extension:` scheme is added, so
// the page still cannot frame any remote origin it could not frame before. The
// sole thing newly permitted to render in a frame is an extension this app
// loaded itself.

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
 * Applies the rewrite to every document response in a session.
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

    callback(changed ? { responseHeaders: headers } : {})
  })
}

module.exports = { allowExtensionFramesInSession, allowExtensionFrames }
