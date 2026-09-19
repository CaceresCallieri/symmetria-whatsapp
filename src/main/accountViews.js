// Owns one WebContentsView per account and decides which is on screen.
//
// Every account view is created up front and kept alive, because WhatsApp Web
// has to stay connected to deliver notifications for an account you are not
// looking at. Switching accounts therefore only re-stacks views; it never
// loads or reloads anything, which is what keeps a switch instant.

const path = require('node:path')
const { WebContentsView } = require('electron')

const { createAccountSession, WHATSAPP_ORIGIN } = require('./accountSession')
const { attachExtensions, loadSurfingkeys } = require('./extensions')
const { openExternalSafely } = require('./externalLinks')
const { accountViewBounds } = require('./layout')

const ACCOUNT_PRELOAD = path.resolve(__dirname, '../preload/account.js')

// A crashed renderer is reloaded, but only a few times -- a view that crashes
// on every load would otherwise spin forever.
const MAX_CRASH_RELOADS = 3

class AccountViews {
  /**
   * @param {Electron.BrowserWindow} window
   * @param {(event: object) => void} onDownload
   * @param {(event: object) => void} [onStatus]  surfaced to the shell as a toast
   */
  constructor(window, onDownload, onStatus = () => {}) {
    this.window = window
    this.onDownload = onDownload
    this.onStatus = onStatus
    this.viewsByAccountId = new Map()
    this.activeAccountId = null
  }

  async create(account) {
    const accountSession = createAccountSession(account.id, { onDownload: this.onDownload })
    const extensions = attachExtensions(accountSession, {
      onCreateTab: (url) => openExternalSafely(url),
    })

    const view = new WebContentsView({
      webPreferences: {
        session: accountSession,
        preload: ACCOUNT_PRELOAD,
        // electron-chrome-extensions requires a sandboxed renderer for the
        // extension preload it prepends. src/preload/account.js is written to
        // work under the sandbox.
        sandbox: true,
        contextIsolation: true,
        // Passes the account id to the preload, which has no other way to learn
        // which account it belongs to.
        additionalArguments: [`--symmetria-account-id=${account.id}`],
      },
    })

    // Surfingkeys' chrome.tabs calls need a registered tab to act on, and the
    // extension has to be loaded into this account's own session -- extension
    // support is per-session, so loading it once globally would not reach here.
    extensions.addTab(view.webContents, this.window)
    await loadSurfingkeys(accountSession)

    // WhatsApp opens shared links with target=_blank. A chat client should hand
    // those to the real browser rather than navigate away from the inbox, and
    // openExternalSafely refuses any scheme that is not http(s).
    view.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })

    // Nothing else constrains where this view can go, and it holds a live
    // WhatsApp login, relaxed CSP, granted microphone and camera, and the
    // Notification shim. A top-level navigation to any other origin would
    // inherit all of it, so off-origin navigation leaves for the browser.
    view.webContents.on('will-navigate', (event, url) => {
      let origin
      try {
        ;({ origin } = new URL(url))
      } catch {
        event.preventDefault()
        return
      }
      if (origin === WHATSAPP_ORIGIN) return
      event.preventDefault()
      openExternalSafely(url)
    })

    this.attachRecovery(view, account)

    view.setVisible(false)
    this.window.contentView.addChildView(view)
    this.viewsByAccountId.set(account.id, { view, extensions })

    // A failed load must not take the other accounts down with it. The view is
    // kept either way: a blank view that can be reloaded beats no view at all,
    // and the startup loop keeps going.
    try {
      await view.webContents.loadURL(WHATSAPP_ORIGIN)
    } catch (error) {
      console.error(`[views] ${account.id} failed to load: ${error.message}`)
      this.onStatus({ accountId: account.id, message: `${account.name} failed to load` })
    }

    this.layout()
    return view
  }

  /** Reloads a view whose renderer crashed or whose load failed. */
  attachRecovery(view, account) {
    let crashReloads = 0

    view.webContents.on('render-process-gone', (_event, details) => {
      if (crashReloads >= MAX_CRASH_RELOADS) {
        console.error(`[views] ${account.id} crashed ${crashReloads} times, not reloading again`)
        this.onStatus({ accountId: account.id, message: `${account.name} keeps crashing` })
        return
      }
      crashReloads += 1
      console.error(`[views] ${account.id} renderer gone (${details.reason}), reloading`)
      view.webContents.reload()
    })

    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
      // -3 is ERR_ABORTED, which Chromium reports for ordinary navigation
      // that was superseded. It is not a failure worth reporting.
      if (!isMainFrame || errorCode === -3) return
      console.error(`[views] ${account.id} load failed (${errorCode} ${errorDescription}): ${url}`)
      this.onStatus({ accountId: account.id, message: `${account.name} is offline` })
    })
  }

  show(accountId) {
    if (!this.viewsByAccountId.has(accountId)) return
    this.activeAccountId = accountId

    for (const [id, { view }] of this.viewsByAccountId) {
      const isActive = id === accountId
      view.setVisible(isActive)
      if (isActive) {
        this.window.contentView.addChildView(view) // re-stack on top
        view.webContents.focus()
      }
    }

    this.layout()
  }

  /** The account a given webContents belongs to, or null if it is not a view. */
  accountIdFor(webContents) {
    for (const [id, { view }] of this.viewsByAccountId) {
      if (view.webContents === webContents) return id
    }
    return null
  }

  /** Resizes every account view to the current window content area. */
  layout() {
    const bounds = accountViewBounds(this.window.getContentBounds())
    for (const { view } of this.viewsByAccountId.values()) {
      view.setBounds(bounds)
    }
  }
}

module.exports = { AccountViews }
