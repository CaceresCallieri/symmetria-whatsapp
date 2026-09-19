// Owns one WebContentsView per account and decides which is on screen.
//
// Every account view is created up front and kept alive, because WhatsApp Web
// has to stay connected to deliver notifications for an account you are not
// looking at. Switching accounts therefore only re-stacks views; it never
// loads or reloads anything, which is what keeps a switch instant.

const path = require('node:path')
const { WebContentsView, shell } = require('electron')

const { createAccountSession, WHATSAPP_ORIGIN } = require('./accountSession')
const { attachExtensions, loadSurfingkeys } = require('./extensions')
const { accountViewBounds } = require('./layout')

const ACCOUNT_PRELOAD = path.resolve(__dirname, '../preload/account.js')

class AccountViews {
  /**
   * @param {Electron.BrowserWindow} window
   * @param {(event: object) => void} onDownload
   */
  constructor(window, onDownload) {
    this.window = window
    this.onDownload = onDownload
    this.viewsByAccountId = new Map()
    this.activeAccountId = null
  }

  async create(account) {
    const accountSession = createAccountSession(account.id, { onDownload: this.onDownload })
    const extensions = attachExtensions(accountSession, {
      onCreateTab: (url) => shell.openExternal(url),
    })

    // Loaded into the session before the view exists, so the extension is ready
    // the moment the first document commits. Extension support is per-session,
    // so loading it once globally would never reach this account.
    await loadSurfingkeys(accountSession)

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

    // Surfingkeys' chrome.tabs calls need a registered tab to act on.
    extensions.addTab(view.webContents, this.window)

    // WhatsApp opens shared links with target=_blank. A chat client should hand
    // those to the real browser rather than navigate away from the inbox.
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    view.setVisible(false)
    this.window.contentView.addChildView(view)
    this.viewsByAccountId.set(account.id, { view, extensions })

    await view.webContents.loadURL(WHATSAPP_ORIGIN)
    this.layout()

    return view
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

  /** Resizes every account view to the current window content area. */
  layout() {
    const bounds = accountViewBounds(this.window.getContentBounds())
    for (const { view } of this.viewsByAccountId.values()) {
      view.setBounds(bounds)
    }
  }

  get activeWebContents() {
    const entry = this.viewsByAccountId.get(this.activeAccountId)
    return entry ? entry.view.webContents : null
  }

  allWebContents() {
    return Array.from(this.viewsByAccountId.values(), ({ view }) => view.webContents)
  }
}

module.exports = { AccountViews }
