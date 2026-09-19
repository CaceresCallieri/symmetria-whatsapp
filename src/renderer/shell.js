// Renderer for the app chrome. Draws the account sidebar, keeps the active
// marker and the unread badges current, and reports clicks back to the main
// process. It never touches WhatsApp -- each account lives in its own
// WebContentsView, out of this document's reach.

const accountButtonsById = new Map()

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

function buildAccountButton(account, index) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'account-button'
  button.style.setProperty('--account-color', account.color)
  button.setAttribute('aria-current', 'false')

  // Ctrl+<n> is bound in the main process; naming it in the tooltip is the
  // only place the shortcut is discoverable.
  button.title = index < 9 ? `${account.name}  (Ctrl+${index + 1})` : account.name
  button.append(initials(account.name))

  const badge = document.createElement('span')
  badge.className = 'account-badge'
  badge.hidden = true
  button.append(badge)

  button.addEventListener('click', () => window.symmetria.selectAccount(account.id))

  accountButtonsById.set(account.id, { button, badge })
  return button
}

function setActiveAccount(accountId) {
  for (const [id, { button }] of accountButtonsById) {
    button.setAttribute('aria-current', String(id === accountId))
  }
  document.getElementById('placeholder').style.display = 'none'
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

  // The main process owns the geometry. Publishing it as custom properties is
  // what stops the CSS and the WebContentsView bounds from drifting apart.
  document.documentElement.style.setProperty('--title-bar-height', `${state.titleBarHeight}px`)
  document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)

  const sidebar = document.getElementById('sidebar')
  state.accounts.forEach((account, index) => sidebar.append(buildAccountButton(account, index)))

  if (!state.keyboardNavigationAvailable) {
    document.getElementById('placeholder-message').textContent =
      'Keyboard navigation is off — run `npm run build:extension`.'
  }

  for (const button of document.querySelectorAll('[data-window-action]')) {
    const action = button.dataset.windowAction
    button.addEventListener('click', () => {
      if (action === 'minimize') window.symmetria.minimize()
      if (action === 'toggle-maximize') window.symmetria.toggleMaximize()
      if (action === 'close') window.symmetria.close()
    })
  }

  window.symmetria.onActiveAccount(setActiveAccount)
  window.symmetria.onUnread(setUnread)
  window.symmetria.onDownload(({ filename, state: downloadState }) => {
    showToast(
      downloadState === 'completed' ? `Saved ${filename}` : `Download failed: ${filename}`
    )
  })
}

start().catch((error) => {
  document.getElementById('placeholder-message').textContent = `Startup failed: ${error.message}`
})
