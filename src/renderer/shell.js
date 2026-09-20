// Renderer for the app chrome. Draws the account sidebar, keeps the active
// marker and the unread badges current, and reports clicks back to the main
// process. It never touches WhatsApp -- each account lives in its own
// WebContentsView, out of this document's reach.
//
// The sidebar is the whole of the chrome. There is no title bar and no
// window-control buttons: the window is frameless and undecorated, and
// Hyprland moves, resizes and closes it.

const accountButtonsById = new Map()

// Published by the main process in the shell state; see src/main/shortcuts.js.
let maxDigitShortcuts = 0

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

/**
 * Shows the account's picture, or its initials when there is no picture.
 *
 * Both elements are built once and toggled, rather than one replacing the
 * other, so a picture that arrives or disappears later never has to rebuild
 * a button that the active marker and the unread badge are attached to.
 *
 * @param {{avatar: HTMLImageElement, initialsText: HTMLElement}} entry
 * @param {string|null} avatarDataUrl
 */
function setAvatar(entry, avatarDataUrl) {
  const hasAvatar = typeof avatarDataUrl === 'string' && avatarDataUrl !== ''
  // Assigned before the toggle, so the button never shows an empty frame in
  // the moment between the initials going and the picture arriving.
  if (hasAvatar) entry.avatar.src = avatarDataUrl
  entry.avatar.hidden = !hasAvatar
  entry.initialsText.hidden = hasAvatar
}

function buildAccountButton(account, index) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'account-button'
  button.style.setProperty('--account-color', account.color)
  button.setAttribute('aria-current', 'false')

  // Ctrl+<n> is bound in the main process; naming it in the tooltip is the
  // only place the shortcut is discoverable. The limit comes from the main
  // process rather than a literal here -- the same drift that layout.js
  // exists to prevent.
  button.title =
    index < maxDigitShortcuts ? `${account.name}  (Ctrl+${index + 1})` : account.name
  // The button's text is the initials, which the picture replaces when there
  // is one. Without this the accessible name would go with them, leaving a
  // screen reader to announce an unlabelled button.
  button.setAttribute('aria-label', account.name)

  // Decorative: the button is already named by aria-label, and an alt text
  // here would have a screen reader announce the account twice.
  const avatar = document.createElement('img')
  avatar.className = 'account-avatar'
  avatar.alt = ''
  avatar.hidden = true

  const initialsText = document.createElement('span')
  initialsText.className = 'account-initials'
  initialsText.textContent = initials(account.name)

  const badge = document.createElement('span')
  badge.className = 'account-badge'
  badge.hidden = true

  button.append(avatar, initialsText, badge)
  button.addEventListener('click', () => window.symmetria.selectAccount(account.id))

  const entry = { button, badge, avatar, initialsText }
  setAvatar(entry, account.avatarDataUrl)

  accountButtonsById.set(account.id, entry)
  return button
}

function setActiveAccount(accountId) {
  let matched = false
  for (const [id, { button }] of accountButtonsById) {
    const isActive = id === accountId
    if (isActive) matched = true
    button.setAttribute('aria-current', String(isActive))
  }
  // Only retire the placeholder once an account is genuinely on screen.
  // Hiding it for an unknown account would leave a blank window with no
  // explanation of what went wrong.
  if (matched) document.getElementById('placeholder').style.display = 'none'
}

function setUnread(accountId, unreadCount) {
  const entry = accountButtonsById.get(accountId)
  if (!entry) return
  const hasUnread = unreadCount > 0
  entry.badge.hidden = !hasUnread
  // Cleared rather than left at '0'. A hidden badge still contributes its text
  // to the button, which is what a screen reader reads out.
  entry.badge.textContent = hasUnread ? (unreadCount > 99 ? '99+' : String(unreadCount)) : ''
}

let toastTimer = null
function showToast(message) {
  const toast = document.getElementById('toast')
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000)
}

async function start() {
  const state = await window.symmetria.getShellState()

  // The main process owns the geometry. Publishing it as a custom property is
  // what stops the CSS and the WebContentsView bounds from drifting apart.
  document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)
  maxDigitShortcuts = state.maxDigitShortcuts

  const sidebar = document.getElementById('sidebar')
  state.accounts.forEach((account, index) => sidebar.append(buildAccountButton(account, index)))

  if (!state.keyboardNavigationAvailable) {
    document.getElementById('placeholder-message').textContent =
      'Keyboard navigation is off — run `npm run build:extension`.'
  }

  window.symmetria.onActiveAccount(setActiveAccount)
  window.symmetria.onUnread(setUnread)
  // Arrives once the account's WhatsApp has booted far enough to know its own
  // profile picture, which is after this sidebar is already on screen.
  window.symmetria.onAccountAvatar((accountId, avatarDataUrl) => {
    const entry = accountButtonsById.get(accountId)
    if (entry) setAvatar(entry, avatarDataUrl)
  })
  window.symmetria.onDownload((event) => {
    // The same channel carries account status messages (a failed load, a
    // crashing view), which have no filename.
    if (event.state === 'status') return showToast(event.message)
    showToast(
      event.state === 'completed' ? `Saved ${event.filename}` : `Download failed: ${event.filename}`
    )
  })
}

start().catch((error) => {
  document.getElementById('placeholder-message').textContent = `Startup failed: ${error.message}`
})
