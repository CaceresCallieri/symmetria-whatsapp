// The picture on an account's sidebar button.
//
// It can come from either of two places, and they are tried in this order:
//
//  1. A file the operator names in accounts.json. This is an override, so a
//     configured picture is never replaced by the one from WhatsApp:
//
//       { "id": "work", "name": "Work", "color": "#53bdeb", "avatar": "~/work.png" }
//
//  2. The account's own WhatsApp profile picture, which the page reads out of
//     WhatsApp's IndexedDB and sends here (see section 4 of the main-world
//     patches in src/preload/account.js). It is cached to disk on arrival so
//     the next launch can show it immediately, before WhatsApp has booted.
//
// Either way the renderer receives the image itself as a data URL, never a
// path: its Content-Security-Policy allows `img-src 'self' data:` and nothing
// else, so a path would need `file:` opened up for the whole document.
//
// Every failure is a warning and a null, never a throw. A missing, unreadable
// or undecodable picture must cost the button its photo and leave the account
// itself working -- the sidebar falls back to the initials, which is also what
// an account with no picture from either source gets.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const channels = require('../shared/channels')
const { withinPixelCap, isImageDataUrlWithin } = require('./imageDecoding')

// The sidebar button is 42 CSS pixels wide. 96 covers a 2x display with room
// to spare, and keeps the encoded result small enough to travel inside the
// shell state rather than needing a channel of its own.
const MAX_AVATAR_PIXELS = 96

// A guard against handing a very large file to the image decoder, not a
// judgement about the photo -- anything past this is not a profile picture.
const MAX_AVATAR_FILE_BYTES = 8 * 1024 * 1024

// The cap for a picture arriving over IPC is far tighter than the one for a
// file on disk, because the two are not the same kind of input. A file is
// named by the operator; this is built by WhatsApp's renderer. Base64 inflates
// by about a third, so this admits roughly 384 KiB of image -- the thumbnail
// WhatsApp stores is a couple of kilobytes.
const MAX_AVATAR_DATA_URL_LENGTH = 512 * 1024

// Where a picture reported by the page is kept, so the button is not blank
// for the seconds it takes WhatsApp to boot on the next launch.
const AVATAR_CACHE_DIRECTORY = 'avatars'

/**
 * Absolute form of a path written by hand in accounts.json.
 *
 * A relative path is refused rather than resolved. It would resolve against
 * the working directory, which depends on how the app was started, so the
 * same config would find the picture from a terminal and miss it from a
 * launcher -- the kind of difference nobody thinks to test.
 *
 * @param {string} configuredPath
 * @returns {string|null}
 */
function resolveAvatarPath(configuredPath) {
  if (configuredPath === '~') return os.homedir()
  if (configuredPath.startsWith('~/')) {
    return path.join(os.homedir(), configuredPath.slice(2))
  }
  if (!path.isAbsolute(configuredPath)) return null
  return configuredPath
}

/**
 * @param {unknown} configuredPath  the `avatar` field of an account
 * @param {string} accountId  named in the warnings, so a bad path is findable
 * @returns {string|null}  a data URL, or null when there is no usable picture
 */
function avatarDataUrlFrom(configuredPath, accountId) {
  if (typeof configuredPath !== 'string' || configuredPath === '') return null

  const filePath = resolveAvatarPath(configuredPath)
  if (!filePath) {
    console.warn(
      `[avatars] ${accountId}: "${configuredPath}" is a relative path. ` +
        'Use an absolute path or one starting with ~/.'
    )
    return null
  }

  let bytes
  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) {
      console.warn(`[avatars] ${accountId}: ${filePath} is not a file`)
      return null
    }
    if (stats.size > MAX_AVATAR_FILE_BYTES) {
      console.warn(
        `[avatars] ${accountId}: ${filePath} is ${stats.size} bytes, ` +
          `past the ${MAX_AVATAR_FILE_BYTES} byte limit`
      )
      return null
    }
    bytes = fs.readFileSync(filePath)
  } catch (error) {
    console.warn(`[avatars] ${accountId}: cannot read ${filePath}: ${error.message}`)
    return null
  }

  const { nativeImage } = require('electron')

  let image
  try {
    image = withinPixelCap(nativeImage.createFromBuffer(bytes), MAX_AVATAR_PIXELS)
  } catch (error) {
    console.warn(`[avatars] ${accountId}: cannot decode ${filePath}: ${error.message}`)
    return null
  }
  if (!image) {
    console.warn(
      `[avatars] ${accountId}: ${filePath} is not an image format Chromium decodes ` +
        '(PNG, JPEG, GIF, WebP and BMP are; SVG is not)'
    )
    return null
  }

  return image.toDataURL()
}

/**
 * Where the picture reported by an account's page is kept between launches.
 *
 * `accountId` is safe in a filename without escaping: src/main/accounts.js
 * refuses any id outside `[A-Za-z0-9_-]`, which is the same rule that stops
 * an id from escaping the session partitions directory.
 *
 * @param {string} accountId
 */
function avatarCachePath(accountId) {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), AVATAR_CACHE_DIRECTORY, `${accountId}.png`)
}

/**
 * Stores a picture reported by the page, as PNG.
 *
 * A failure here is not worth interrupting anything for: the picture is
 * already on its way to the sidebar, and all that is lost is the head start
 * on the next launch.
 *
 * @param {string} accountId
 * @param {Electron.NativeImage} image
 */
function cacheAvatar(accountId, image) {
  const filePath = avatarCachePath(accountId)
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, image.toPNG())
  } catch (error) {
    console.warn(`[avatars] ${accountId}: cannot cache the picture: ${error.message}`)
  }
}

/**
 * The cached picture for an account, or null when there is not one yet.
 *
 * A missing file is the ordinary case on a first run, so unlike a configured
 * path this says nothing when it finds nothing.
 *
 * @param {string} accountId
 */
function cachedAvatarDataUrl(accountId) {
  let filePath
  try {
    filePath = avatarCachePath(accountId)
  } catch {
    // app.getPath throws before Electron is ready. Nothing asks for an avatar
    // that early, but a cache miss is the right answer if anything ever does.
    return null
  }
  if (!fs.existsSync(filePath)) return null
  return avatarDataUrlFrom(filePath, accountId)
}

/**
 * Turns a picture reported by an account's page into an image, or nothing.
 *
 * This is page-controlled data, so it gets the same treatment as a
 * notification avatar: an inert image data URL under a size cap, never an
 * address the main process would go and fetch.
 *
 * @param {unknown} source
 * @returns {Electron.NativeImage|null}
 */
function reportedAvatarImageFrom(source) {
  if (!isImageDataUrlWithin(source, MAX_AVATAR_DATA_URL_LENGTH)) return null

  const { nativeImage } = require('electron')
  try {
    return withinPixelCap(nativeImage.createFromDataURL(source), MAX_AVATAR_PIXELS)
  } catch {
    return null
  }
}

/**
 * Receives the profile picture an account's page reports.
 *
 * @param {object} deps
 * @param {(webContents: Electron.WebContents) => string|null} deps.accountIdFor
 * @param {(accountId: string) => string} deps.configuredAvatarFor
 * @param {(accountId: string, avatarDataUrl: string) => void} deps.onAvatarChanged
 */
function registerAccountAvatarBridge({ accountIdFor, configuredAvatarFor, onAvatarChanged }) {
  const { ipcMain } = require('electron')

  ipcMain.on(channels.ACCOUNT_AVATAR, (event, source) => {
    // Derived from the sender, never taken from the message. A renderer could
    // otherwise put its picture on another account's button.
    const accountId = accountIdFor(event.sender)
    if (!accountId) return

    // A configured picture is an override, so the one from WhatsApp is not
    // cached either. Caching it would make removing the override change the
    // button to a photo the operator never chose.
    if (configuredAvatarFor(accountId)) return

    const image = reportedAvatarImageFrom(source)
    if (!image) {
      console.warn(`[avatars] ${accountId}: the page reported something that is not a picture`)
      return
    }

    cacheAvatar(accountId, image)
    onAvatarChanged(accountId, image.toDataURL())
  })
}

/**
 * The account list as the shell renderer needs it, with each account's
 * picture resolved to the image itself.
 *
 * The field is renamed on the way through. `avatar` is a path on disk and
 * `avatarDataUrl` is an image, and letting one name mean both is how a path
 * ends up in an `<img src>` that silently shows nothing.
 *
 * Read on every call rather than cached. The shell renderer asks once, when
 * it starts, so a cache would save nothing and would instead hold a stale
 * picture after the file behind it changed.
 *
 * @param {Array<{id: string, name: string, color: string, avatar?: string}>} accounts
 */
function accountsWithAvatars(accounts) {
  return accounts.map(({ avatar, ...account }) => ({
    ...account,
    // The configured file wins. The cache is only consulted when there is no
    // override, and holds whatever the page last reported.
    avatarDataUrl: avatarDataUrlFrom(avatar, account.id) || cachedAvatarDataUrl(account.id),
  }))
}

module.exports = {
  accountsWithAvatars,
  registerAccountAvatarBridge,
  avatarDataUrlFrom,
  reportedAvatarImageFrom,
  resolveAvatarPath,
  MAX_AVATAR_PIXELS,
  MAX_AVATAR_FILE_BYTES,
  MAX_AVATAR_DATA_URL_LENGTH,
}
