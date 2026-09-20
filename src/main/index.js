// Application entry point.
//
// The window is a frameless, undecorated BrowserWindow whose own renderer
// draws the account sidebar and nothing else (src/renderer). Each account's
// WhatsApp Web sits in a WebContentsView stacked into the same window's
// content view, positioned by src/main/layout.js. The renderer never loads
// remote content, so the chrome stays a trusted context while WhatsApp stays
// sandboxed in its own session.
//
// The window is also transparent, so the desktop shows through the sidebar
// strip -- see the note on `transparent` in createWindow.

const path = require('node:path')
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')

const channels = require('../shared/channels')
const { loadAccounts } = require('./accounts')
const { AccountViews } = require('./accountViews')
const { registerNotificationBridge } = require('./notifications')
const { bindAccountShortcuts, MAX_DIGIT_SHORTCUTS } = require('./shortcuts')
const { isExtensionBuilt } = require('./extensions')
const { SIDEBAR_WIDTH } = require('./layout')

const RENDERER_HTML = path.resolve(__dirname, '../renderer/index.html')
const SHELL_PRELOAD = path.resolve(__dirname, '../preload/shell.js')
const APP_ICON = path.resolve(__dirname, '../../resources/icons/whatsapp-256x256.png')

// Wayland compositors key window rules off the app id, and Hyprland rules for
// this app are written against this name. Electron derives the app id from the
// application name, so it has to be set before the first window exists.
app.setName('symmetria-whatsapp')

// Everything below assumes one process owns the account sessions. A second
// instance would fight the first over the same partition directories, so it
// exits immediately -- app.quit() alone would let the rest of this module keep
// running and touch accounts.json before the quit settled.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

let mainWindow = null
let accountViews = null
let accounts = []

/** True when the window is gone or on its way out. */
function windowIsUsable() {
  return Boolean(mainWindow) && !mainWindow.isDestroyed()
}

function sendToShell(channel, ...args) {
  if (!windowIsUsable()) return
  mainWindow.webContents.send(channel, ...args)
}

function accountIndexOf(accountId) {
  return accounts.findIndex((account) => account.id === accountId)
}

function activate(accountId) {
  if (!windowIsUsable()) return

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  // Reachable before any account view exists (a second-instance launch during
  // startup). Focusing the window is still the right response; broadcasting an
  // undefined account would clear every sidebar marker and hide the loading
  // placeholder, leaving an apparently empty app.
  if (!accountId || !accountViews) return

  accountViews.show(accountId)
  sendToShell(channels.ACTIVE_ACCOUNT, accountId)
}

function selectIndex(index) {
  const account = accounts[index]
  if (account) activate(account.id)
}

function cycle(offset) {
  if (!accountViews || accounts.length === 0) return
  const current = Math.max(0, accountIndexOf(accountViews.activeAccountId))
  const next = (current + offset + accounts.length) % accounts.length
  selectIndex(next)
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    // The sidebar is drawn at 60% opacity over nothing, so the window itself
    // has to be able to carry alpha. This can only be set at creation, and it
    // needs the renderer's <body> to stay transparent as well -- an opaque
    // body paints over it and the window looks solid with nothing to explain
    // why. Every other region of the window is covered by an account's
    // WebContentsView, which is opaque, so WhatsApp itself is unaffected.
    transparent: true,
    backgroundColor: '#00000000',
    icon: APP_ICON,
    webPreferences: {
      preload: SHELL_PRELOAD,
      // The shell preload needs nothing from Node beyond `electron` itself,
      // so it runs under the same sandbox the account views use.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    accountViews = null
  })

  await mainWindow.loadFile(RENDERER_HTML)
  mainWindow.show()

  accountViews = new AccountViews(
    mainWindow,
    (download) => sendToShell(channels.DOWNLOAD, download),
    (status) => sendToShell(channels.DOWNLOAD, { ...status, state: 'status' })
  )

  // The account views are absolutely positioned, so every resize has to
  // re-run the layout. 'resize' fires continuously while dragging; setBounds
  // is cheap enough that throttling would cost more in lag than it saves.
  mainWindow.on('resize', () => accountViews?.layout())

  bindAccountShortcuts(mainWindow.webContents, {
    onSelectIndex: selectIndex,
    onCycle: cycle,
  })

  // Accounts load one after another rather than all at once. Several WhatsApp
  // Web instances booting in parallel compete for the same CPU, and the first
  // account -- the one the user is about to look at -- gets there later.
  //
  // One account failing must not abort the loop: without this guard a single
  // rejected load left every later account uncreated and the sidebar stuck on
  // "Loading accounts…" forever.
  for (const account of accounts) {
    if (!windowIsUsable()) return
    try {
      const view = await accountViews.create(account)
      bindAccountShortcuts(view.webContents, {
        onSelectIndex: selectIndex,
        onCycle: cycle,
      })
    } catch (error) {
      console.error(`[startup] could not create the view for ${account.id}: ${error.message}`)
    }
  }

  if (accounts.length > 0) activate(accounts[0].id)
}

app.whenReady().then(async () => {
  // Makes Chromium report `prefers-color-scheme: dark` to WhatsApp Web, which
  // its "System default" theme reads to switch itself dark. Without this the
  // web view renders light inside a dark window. Set after ready so no
  // Electron build can treat it as a premature call. The Qt version forced the
  // same thing.
  nativeTheme.themeSource = 'dark'

  accounts = loadAccounts()

  registerNotificationBridge({
    onActivate: activate,
    accountIdFor: (webContents) => accountViews?.accountIdFor(webContents) ?? null,
    accountNameFor: (accountId) => accounts[accountIndexOf(accountId)]?.name || '',
    onUnreadChange: (accountId, unreadCount) => {
      sendToShell(channels.UNREAD_CHANGED, accountId, unreadCount)
    },
  })

  // The renderer asks for this once it is ready, rather than the main process
  // pushing into a page that may not have registered its listeners yet.
  ipcMain.handle(channels.SHELL_STATE, () => ({
    accounts,
    sidebarWidth: SIDEBAR_WIDTH,
    maxDigitShortcuts: MAX_DIGIT_SHORTCUTS,
    keyboardNavigationAvailable: isExtensionBuilt(),
  }))

  ipcMain.on(channels.SELECT_ACCOUNT, (_event, accountId) => activate(accountId))

  await createWindow()
}).catch((error) => {
  console.error('[startup] failed:', error)
  app.exit(1)
})

app.on('second-instance', () => {
  activate(accountViews?.activeAccountId || accounts[0]?.id)
})

app.on('window-all-closed', () => app.quit())
