// Account list persistence.
//
// An account is just a name, a colour and a stable id. The id is what names the
// session partition and the storage directory, so it must never change once an
// account has logged in -- renaming an account changes `name` only.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const ACCOUNTS_FILE_NAME = 'accounts.json'

const DEFAULT_ACCOUNTS = [
  { id: 'personal', name: 'Personal', color: '#25d366' },
  { id: 'work', name: 'Work', color: '#53bdeb' },
]

function accountsFilePath() {
  return path.join(app.getPath('userData'), ACCOUNTS_FILE_NAME)
}

function loadAccounts() {
  const filePath = accountsFilePath()

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
    console.warn(`[accounts] ${filePath} holds no accounts, using defaults`)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[accounts] cannot read ${filePath}: ${error.message}, using defaults`)
    }
  }

  saveAccounts(DEFAULT_ACCOUNTS)
  return DEFAULT_ACCOUNTS
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

module.exports = { loadAccounts, saveAccounts, accountsFilePath, DEFAULT_ACCOUNTS }
