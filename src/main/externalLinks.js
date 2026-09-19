// Opening a URL that came from web content.
//
// Two call sites hand this module a URL that WhatsApp -- or Surfingkeys acting
// on WhatsApp's markup -- chose: the `target=_blank` handler and the extension's
// chrome.tabs.create bridge. Both were previously calling shell.openExternal
// directly, which hands the string to the desktop's URL dispatcher and will
// happily launch a registered handler for `file:`, `smb:`, `ms-msdt:` and
// anything else installed on the machine. Page-controlled input must never
// reach that dispatcher unfiltered.

const { shell } = require('electron')

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:'])

/**
 * Opens a web URL in the user's browser, refusing anything that is not plain
 * http(s). Returns whether the URL was opened, so callers can log a refusal.
 */
function openExternalSafely(url) {
  let protocol
  try {
    ;({ protocol } = new URL(url))
  } catch {
    console.warn(`[links] refused to open a malformed URL: ${String(url).slice(0, 120)}`)
    return false
  }

  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    console.warn(`[links] refused to open a non-web URL (${protocol}): ${url.slice(0, 120)}`)
    return false
  }

  shell.openExternal(url)
  return true
}

module.exports = { openExternalSafely }
