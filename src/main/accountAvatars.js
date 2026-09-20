// The picture on an account's sidebar button.
//
// An account may name an image file in accounts.json:
//
//   { "id": "work", "name": "Work", "color": "#53bdeb", "avatar": "~/work.png" }
//
// The file is read here, decoded, capped, and handed to the shell renderer as
// a data URL. It is never handed over as a path: the renderer's
// Content-Security-Policy allows `img-src 'self' data:` and nothing else, so
// a path would need `file:` opened up for the whole document.
//
// Every failure is a warning and a null, never a throw. A missing or
// unreadable picture must cost the button its photo and leave the account
// itself working -- the sidebar falls back to the initials, which is also
// what an account with no `avatar` field gets.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { withinPixelCap } = require('./imageDecoding')

// The sidebar button is 42 CSS pixels wide. 96 covers a 2x display with room
// to spare, and keeps the encoded result small enough to travel inside the
// shell state rather than needing a channel of its own.
const MAX_AVATAR_PIXELS = 96

// A guard against handing a very large file to the image decoder, not a
// judgement about the photo -- anything past this is not a profile picture.
const MAX_AVATAR_FILE_BYTES = 8 * 1024 * 1024

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
 * The account list as the shell renderer needs it: the configured `avatar`
 * path replaced by the picture itself.
 *
 * The field is renamed on the way through. `avatar` is a path on disk and
 * `avatarDataUrl` is an image, and letting one name mean both is how a path
 * ends up in an `<img src>` that silently shows nothing.
 *
 * Read on every call rather than cached. The shell renderer asks once, when
 * it starts, so a cache would save nothing and would instead hold a stale
 * picture after the operator replaces the file.
 *
 * @param {Array<{id: string, name: string, color: string, avatar?: string}>} accounts
 */
function accountsWithAvatars(accounts) {
  return accounts.map(({ avatar, ...account }) => ({
    ...account,
    avatarDataUrl: avatarDataUrlFrom(avatar, account.id),
  }))
}

module.exports = {
  accountsWithAvatars,
  avatarDataUrlFrom,
  resolveAvatarPath,
  MAX_AVATAR_PIXELS,
  MAX_AVATAR_FILE_BYTES,
}
