// Application entry point.
//
// The window is a frameless BrowserWindow whose own renderer draws the title
// bar and the account sidebar (src/renderer). Each account's WhatsApp Web sits
// in a WebContentsView stacked into the same window's content view, positioned
// by src/main/layout.js. The renderer never loads remote content, so the chrome
// stays a trusted context while WhatsApp stays sandboxed in its own session.

const path = require('node:path')
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')

const { loadAccounts } = require('./accounts')
const { AccountViews } = require('./accountViews')
const { registerNotificationBridge } = require('./notifications')
const { bindAccountShortcuts } = require('./shortcuts')
const { isExtensionBuilt } = require('./extensions')
const { TITLE_BAR_HEIGHT, SIDEBAR_WIDTH } = require('./layout')

const RENDERER_HTML = path.resolve(__dirname, '../renderer/index.html')
const SHELL_PRELOAD = path.resolve(__dirname, '../preload/shell.js')
const APP_ICON = path.resolve(__dirname, '../../resources/icons/whatsapp-256x256.png')

// Wayland compositors key window rules off the app id, and Hyprland rules for
// this app are written against this name. Electron derives the app id from the
// application name, so it has to be set before the first window exists.
app.setName('symmetria-whatsapp')

// Makes Chromium report `prefers-color-scheme: dark` to WhatsApp Web, which its
// "System default" theme reads to switch itself dark. Without this the web view
// renders light inside a dark window. The Qt version forced the same thing.
nativeTheme.themeSource = 'dark'

// Everything below assumes one process owns the account sessions. A second
// instance would fight the first over the same partition directories.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow = null
let accountViews = null
let accounts = []

function accountIndexOf(accountId) {
  return accounts.findIndex((account) => account.id === accountId)
}

function activate(accountId) {
  if (!mainWindow || !accountViews) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  accountViews.show(accountId)
  mainWindow.webContents.send('symmetria:active-account', accountId)
}

function selectIndex(index) {
  const account = accounts[index]
  if (account) activate(account.id)
}

function cycle(offset) {
  if (accounts.length === 0) return
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
    backgroundColor: '#0b141a',
    icon: APP_ICON,
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await mainWindow.loadFile(RENDERER_HTML)
  mainWindow.show()

  accountViews = new AccountViews(mainWindow, (download) => {
    mainWindow.webContents.send('symmetria:download', download)
  })

  // The account views are absolutely positioned, so every resize has to
  // re-run the layout. 'resize' fires continuously while dragging; setBounds
  // is cheap enough that throttling would cost more in lag than it saves.
  mainWindow.on('resize', () => accountViews.layout())

  bindAccountShortcuts(mainWindow.webContents, {
    onSelectIndex: selectIndex,
    onCycle: cycle,
  })

  // Accounts load one after another rather than all at once. Several WhatsApp
  // Web instances booting in parallel compete for the same CPU, and the first
  // account -- the one the user is about to look at -- gets there later.
  for (const account of accounts) {
    const view = await accountViews.create(account)
    bindAccountShortcuts(view.webContents, {
      onSelectIndex: selectIndex,
      onCycle: cycle,
    })
  }

  if (accounts.length > 0) activate(accounts[0].id)
}

app.whenReady().then(async () => {
  accounts = loadAccounts()

  registerNotificationBridge({
    onActivate: activate,
    accountNameFor: (accountId) => accounts[accountIndexOf(accountId)]?.name || '',
    onUnreadChange: (accountId, unreadCount) => {
      mainWindow?.webContents.send('symmetria:unread', accountId, unreadCount)
    },
  })

  // The renderer asks for this once it is ready, rather than the main process
  // pushing into a page that may not have registered its listeners yet.
  ipcMain.handle('symmetria:shell-state', () => ({
    accounts,
    titleBarHeight: TITLE_BAR_HEIGHT,
    sidebarWidth: SIDEBAR_WIDTH,
    keyboardNavigationAvailable: isExtensionBuilt(),
  }))

  ipcMain.on('symmetria:select-account', (_event, accountId) => activate(accountId))
  ipcMain.on('symmetria:window', (_event, action) => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    if (action === 'close') mainWindow.close()
    if (action === 'toggle-maximize') {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    }
  })

  await createWindow()
})

app.on('second-instance', () => {
  if (mainWindow) activate(accountViews?.activeAccountId || accounts[0]?.id)
})

app.on('window-all-closed', () => app.quit())
