// Surfingkeys loading.
//
// This is the whole reason the app is built on Electron rather than Qt. Qt
// WebEngine exposes no extension API at all -- only user scripts, which is the
// raw-JS-injection route the project abandoned. Electron can host a real
// extension, so the vim-style keyboard layer is rented from Surfingkeys and
// maintained by its authors instead of by us.
//
// Electron implements only a small subset of the chrome.* APIs by itself;
// electron-chrome-extensions supplies tabs, windows, commands, action, storage,
// cookies, contextMenus, notifications and webNavigation on top. Surfingkeys
// features backed by chrome.bookmarks, history, downloads, sessions, topSites,
// tabGroups, tts, proxy, userScripts or nativeMessaging have no backing API and
// stay dead. None of them mean anything in a single-site client -- you do not
// bookmark a chat -- and the spike confirmed the extension's service worker
// survives their absence.

const fs = require('node:fs')
const path = require('node:path')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')

const EXTENSION_PATH = path.resolve(__dirname, '../../vendor/surfingkeys')

function isExtensionBuilt() {
  return fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))
}

/**
 * Attaches extension support to one account session and loads Surfingkeys.
 *
 * Returns the ElectronChromeExtensions instance, which the caller must feed
 * with `addTab` once the account's view exists -- without a registered tab the
 * extension's chrome.tabs calls have nothing to act on.
 *
 * Every account session needs its own instance, because extension support is
 * per-session. One consequence worth knowing: Surfingkeys' configuration lives
 * in chrome.storage.local, which is also per-session, so a keybinding changed
 * from inside one account does not follow to the others.
 */
function attachExtensions(accountSession, { onCreateTab } = {}) {
  // GPL-3.0 is the licence this repository carries, which is the correct
  // declaration for electron-chrome-extensions' dual-licence check. Using it
  // under any other licence requires the author's patron licence.
  const extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: accountSession,

    // Surfingkeys asks for a new tab on commands this app does not offer
    // (`t`, `on`). Hand the URL to the default browser instead of silently
    // dropping it, so a link opened by hint mode still goes somewhere. The URL
    // came from WhatsApp's markup via hint mode, so the caller filters its
    // scheme before it reaches the desktop's URL dispatcher.
    createTab: async (details) => {
      if (onCreateTab && details.url) onCreateTab(details.url)
      throw new Error('symmetria-whatsapp is single-tab')
    },
    selectTab: () => {},
    removeTab: () => {},
    createWindow: async () => {
      throw new Error('symmetria-whatsapp is single-window')
    },
    removeWindow: () => {},
  })

  return extensions
}

async function loadSurfingkeys(accountSession) {
  if (!isExtensionBuilt()) {
    console.warn(
      `[extensions] no Surfingkeys build at ${EXTENSION_PATH}. ` +
        'Keyboard navigation is off. Run `npm run build:extension`.'
    )
    return null
  }

  try {
    return await accountSession.extensions.loadExtension(EXTENSION_PATH)
  } catch (error) {
    console.error(`[extensions] Surfingkeys failed to load: ${error.message}`)
    return null
  }
}

module.exports = { attachExtensions, loadSurfingkeys, isExtensionBuilt }
