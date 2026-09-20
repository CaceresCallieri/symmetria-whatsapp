// Shared rules for turning decoded bytes into an image this app is willing to
// show.
//
// Two callers decode an image that came from outside the main process: the
// notification avatar in src/main/notificationIcon.js, whose bytes come from
// WhatsApp's renderer, and the sidebar account picture in
// src/main/accountAvatars.js, whose bytes come from a file the operator named
// in accounts.json. They differ in where the bytes come from and in how large
// a result is reasonable, so each keeps its own cap and its own acceptance
// rules -- but the decode itself behaves the same way for both, and both of
// its failures are silent.
//
// Nothing here requires `electron`. The caller has already built the
// NativeImage, which is what keeps this module testable under plain Node:
// Electron is an Arch system package rather than a node_modules dependency,
// so `node --test` has no Electron runtime to create one with.

const IMAGE_DATA_URL_PREFIX = 'data:image/'

/**
 * Whether `source` is something the main process is willing to decode.
 *
 * Pure, and the entire boundary between a page and an image decode in the
 * privileged process. Both callers pass data that WhatsApp's renderer built,
 * so both need the same two guarantees: the bytes are inert and already here,
 * never an address the main process would go and fetch, and there are not too
 * many of them.
 *
 * @param {unknown} source
 * @param {number} maxLength  cap on the data URL's length, in characters
 * @returns {boolean}
 */
function isImageDataUrlWithin(source, maxLength) {
  if (typeof source !== 'string') return false
  if (!source.startsWith(IMAGE_DATA_URL_PREFIX)) return false
  return source.length <= maxLength
}

/**
 * The image, resized so its longer side is at most `maxPixels`, or null when
 * there is no usable image at all.
 *
 * @param {{isEmpty: () => boolean, getSize: () => {width: number, height: number}, resize: (options: object) => unknown}} image
 * @param {number} maxPixels  cap on the longer side, in pixels
 * @returns {unknown|null}  the same image, a resized copy, or null
 */
function withinPixelCap(image, maxPixels) {
  // Chromium reports a format it cannot decode by returning an empty image
  // rather than by throwing, so this is the only signal that the bytes were
  // not a picture. SVG is the case that reaches here.
  if (image.isEmpty()) return null

  const { width, height } = image.getSize()
  if (Math.max(width, height) <= maxPixels) return image

  // Resizing one dimension keeps the aspect ratio, and it has to be the
  // larger one: capping the shorter side leaves the longer side over the cap.
  return image.resize(width >= height ? { width: maxPixels } : { height: maxPixels })
}

module.exports = { withinPixelCap, isImageDataUrlWithin }
