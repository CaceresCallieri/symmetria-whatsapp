// Turns the sender avatar the page sent into a NativeImage for the desktop
// notification, or into nothing at all.
//
// The avatar arrives as a data URL built inside the account's renderer (see
// src/preload/account.js). It is therefore page-controlled data, and every
// rule below exists because of that: the main process accepts only an inert
// image data URL, never a URL it would have to go and fetch, and never one
// large enough to be a problem on its own.
//
// Electron maps a notification's `icon` to libnotify's image slot rather than
// to the application icon, so what this produces is shown by the daemon as the
// notification's picture -- which is exactly what a sender avatar should be.

// `electron` is required inside the function rather than at the top of this
// file. Electron is an Arch system package here and not a node_modules
// dependency, so `require('electron')` throws under plain Node -- and
// test/notificationIcon.test.js runs under plain Node. Deferring the require
// keeps the acceptance rules in the same file as the code they guard, so a
// reader judging what the main process will accept has it all in one place.

const { withinPixelCap } = require('./imageDecoding')

const ICON_DATA_URL_PREFIX = 'data:image/'

// Base64 inflates by about a third, so this admits roughly 512 KiB of image.
// A notification avatar is a thumbnail; anything larger is not one.
const MAX_ICON_DATA_URL_LENGTH = 700 * 1024

// A compressed image says nothing about its decoded size -- a flat 4000x4000
// PNG is a few kilobytes on the wire and 64 MB as a pixbuf. The byte cap above
// cannot catch that, so the pixel cap does.
const MAX_ICON_PIXELS = 256

/**
 * Whether `source` is something the main process is willing to decode.
 *
 * Pure, and exported for the tests: the checks here are the entire security
 * boundary between WhatsApp's renderer and an image decode in the privileged
 * process, and their failure is silent in both directions -- too strict loses
 * the avatar, too loose loses the boundary.
 *
 * @param {unknown} source
 * @returns {boolean}
 */
function isAcceptableIconDataUrl(source) {
  if (typeof source !== 'string') return false
  if (!source.startsWith(ICON_DATA_URL_PREFIX)) return false
  return source.length <= MAX_ICON_DATA_URL_LENGTH
}

/**
 * @param {unknown} source  the `icon` field of a notification payload
 * @returns {Electron.NativeImage|null}  null whenever there is no usable image
 */
function notificationIconFrom(source) {
  if (!isAcceptableIconDataUrl(source)) return null

  const { nativeImage } = require('electron')

  let image
  try {
    image = nativeImage.createFromDataURL(source)
  } catch {
    return null
  }

  return withinPixelCap(image, MAX_ICON_PIXELS)
}

module.exports = {
  notificationIconFrom,
  isAcceptableIconDataUrl,
  MAX_ICON_DATA_URL_LENGTH,
  MAX_ICON_PIXELS,
}
