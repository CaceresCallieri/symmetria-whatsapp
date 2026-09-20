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

// A compressed image says nothing about the memory it needs once decoded: a
// flat 4000x4000 PNG is a few kilobytes on the wire and 64 MB as a bitmap.
// Neither the callers' byte caps nor `withinPixelCap` can prevent that --
// by the time a size is readable, Chromium has already decompressed the
// whole thing inside the privileged main process.
//
// So the dimensions are read out of the file header first, before any
// decoder sees the bytes. 40 megapixels is far past any avatar and still
// only ~160 MB decoded, so a legitimate picture is never refused by it.
const MAX_DECODED_PIXELS = 40 * 1000 * 1000

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** @returns {{width: number, height: number}|null} */
function pngDimensions(bytes) {
  if (bytes.length < 24) return null
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  // The spec requires IHDR to be the first chunk: a 4-byte length, the type,
  // then width and height as big-endian 32-bit integers.
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** @returns {{width: number, height: number}|null} */
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]

    // Fill bytes, and the markers that carry no length field at all.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    // A start-of-frame segment holds the dimensions. C4, C8 and CC sit in
    // the same range but are tables rather than frames.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }

    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

/**
 * The dimensions in the file header, or null when the format is not one
 * whose header this reads.
 *
 * Only PNG and JPEG are understood, which is exactly the set `nativeImage`
 * decodes -- verified against Electron 43: GIF, WebP, BMP and SVG all come
 * back empty. Anything else therefore reaches a decoder that refuses it.
 *
 * @param {Buffer} bytes
 */
function declaredDimensions(bytes) {
  return pngDimensions(bytes) || jpegDimensions(bytes)
}

/**
 * Whether these bytes are safe to hand to an image decoder.
 *
 * Unreadable headers pass: this narrows the blast radius of a decompression
 * bomb, it is not the thing deciding what counts as an image. That is still
 * the decoder's job, and `withinPixelCap` still bounds what is retained.
 *
 * @param {Buffer} bytes
 * @param {number} [maxPixels]
 */
function withinDecodeBudget(bytes, maxPixels = MAX_DECODED_PIXELS) {
  const dimensions = declaredDimensions(bytes)
  if (!dimensions) return true
  return dimensions.width * dimensions.height <= maxPixels
}

/**
 * The bytes carried by a base64 image data URL, or null.
 *
 * Both producers of these URLs are ours (src/preload/account.js, via
 * FileReader and canvas), and both emit base64. A percent-encoded data URL
 * is therefore not something this app makes.
 *
 * @param {string} source
 * @returns {Buffer|null}
 */
function bytesFromImageDataUrl(source) {
  const comma = source.indexOf(',')
  if (comma === -1) return null
  if (!source.slice(0, comma).endsWith(';base64')) return null
  const bytes = Buffer.from(source.slice(comma + 1), 'base64')
  return bytes.length > 0 ? bytes : null
}

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
 * This bounds the memory the app *retains*, not the memory the decode takes:
 * the bytes are fully decompressed before a size can be read. Use
 * `withinDecodeBudget` before the decode to bound that.
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

module.exports = {
  withinPixelCap,
  isImageDataUrlWithin,
  withinDecodeBudget,
  declaredDimensions,
  bytesFromImageDataUrl,
  MAX_DECODED_PIXELS,
}
