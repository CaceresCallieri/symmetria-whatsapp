// Account list persistence.
//
// An account is a name, a colour, a stable id and an optional picture. The id
// is what names the session partition and the storage directory, so it must
// never change once an account has logged in -- renaming an account changes
// `name` only.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const ACCOUNTS_FILE_NAME = 'accounts.json'

// The id becomes a directory name under Electron's partitions path, so it is
// restricted to characters that cannot traverse out of it or collide with the
// filesystem. A `/` or `..` in this field would place an account's session
// somewhere else entirely.
const VALID_ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/

const DEFAULT_ACCOUNTS = [
  { id: 'personal', name: 'Personal', color: '#25d366' },
  { id: 'work', name: 'Work', color: '#53bdeb' },
]

const DEFAULT_COLOR = '#25d366'

function accountsFilePath() {
  return path.join(app.getPath('userData'), ACCOUNTS_FILE_NAME)
}

/**
 * Keeps only entries that can safely become a session partition and render in
 * the sidebar. This file is hand-editable, so every field is treated as
 * untrusted input rather than as something this app wrote.
 */
function validateAccounts(parsed) {
  if (!Array.isArray(parsed)) return []

  const seenIds = new Set()
  const accounts = []

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      console.warn('[accounts] skipped an entry that is not an object')
      continue
    }
    if (typeof entry.id !== 'string' || !VALID_ACCOUNT_ID.test(entry.id)) {
      console.warn(`[accounts] skipped an entry with an unusable id: ${JSON.stringify(entry.id)}`)
      continue
    }
    if (seenIds.has(entry.id)) {
      // Two accounts sharing an id would share one session and one view,
      // which looks like an account silently vanishing.
      console.warn(`[accounts] skipped a duplicate id: ${entry.id}`)
      continue
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      console.warn(`[accounts] skipped ${entry.id}: it has no usable name`)
      continue
    }

    seenIds.add(entry.id)
    accounts.push({
      id: entry.id,
      name: entry.name,
      color: typeof entry.color === 'string' ? entry.color : DEFAULT_COLOR,
      // A path to the picture on the sidebar button. Only its type is checked
      // here. Whether the file exists and decodes is decided later, by
      // src/main/accountAvatars.js, because an account whose picture has been
      // moved or deleted is still a working account -- it falls back to its
      // initials. Dropping the whole account over it would hide a logged-in
      // session behind a typo in an optional field.
      avatar: typeof entry.avatar === 'string' ? entry.avatar : '',
    })
  }

  return accounts
}

function loadAccounts() {
  const filePath = accountsFilePath()

  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      saveAccounts(DEFAULT_ACCOUNTS)
      return DEFAULT_ACCOUNTS
    }
    // Never overwrite a file that exists but could not be read -- an EACCES
    // is a permissions problem, not a reason to discard the user's accounts.
    console.error(`[accounts] cannot read ${filePath}: ${error.message}. Using defaults in memory.`)
    return DEFAULT_ACCOUNTS
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // The file is the only copy of the account list, so a syntax error must
    // never silently destroy it. Move it aside and say where it went.
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`
    try {
      fs.renameSync(filePath, quarantinePath)
      console.error(
        `[accounts] ${filePath} is not valid JSON (${error.message}). ` +
          `Moved it to ${quarantinePath} and wrote defaults.`
      )
    } catch (renameError) {
      console.error(`[accounts] could not quarantine the corrupt file: ${renameError.message}`)
      return DEFAULT_ACCOUNTS
    }
    saveAccounts(DEFAULT_ACCOUNTS)
    return DEFAULT_ACCOUNTS
  }

  const accounts = validateAccounts(parsed)
  if (accounts.length === 0) {
    console.warn(`[accounts] ${filePath} holds no usable accounts, using defaults`)
    return DEFAULT_ACCOUNTS
  }

  return accounts
}

function saveAccounts(accounts) {
  const filePath = accountsFilePath()
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2))
  } catch (error) {
    console.error(`[accounts] cannot write ${filePath}: ${error.message}`)
  }
}

module.exports = { loadAccounts, validateAccounts }
