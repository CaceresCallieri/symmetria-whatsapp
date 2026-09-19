// Account-switching keys.
//
// These are bound with `before-input-event` rather than a global accelerator or
// a Menu, because the key has to be caught while WhatsApp Web holds focus --
// and caught before the page sees it, so WhatsApp cannot swallow it.
//
// Everything *inside* a conversation is Surfingkeys' job. This file owns only
// the keys that move between accounts, which no extension can know about.
// Ctrl+digit and Ctrl+Tab are deliberately outside Surfingkeys' default map, so
// the two do not fight.

const MAX_DIGIT_SHORTCUTS = 9

/**
 * @param {Electron.WebContents} webContents
 * @param {object} handlers
 * @param {(index: number) => void} handlers.onSelectIndex
 * @param {(offset: number) => void} handlers.onCycle
 */
function bindAccountShortcuts(webContents, { onSelectIndex, onCycle }) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return

    if (input.key === 'Tab') {
      event.preventDefault()
      onCycle(input.shift ? -1 : 1)
      return
    }

    const digit = Number(input.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= MAX_DIGIT_SHORTCUTS) {
      event.preventDefault()
      onSelectIndex(digit - 1)
    }
  })
}

module.exports = { bindAccountShortcuts, MAX_DIGIT_SHORTCUTS }
