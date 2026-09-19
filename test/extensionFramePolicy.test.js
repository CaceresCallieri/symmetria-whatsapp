// Tests for the CSP rewriter.
//
// This function is worth testing above everything else in the project: it
// rewrites a security header, it runs on every document response, and its
// failure mode is silent -- hints keep working while the Surfingkeys omnibar
// quietly never renders. Two real defects (the 'none' source list and
// comma-combined policies) were found by review rather than by running the
// app, because neither shows up as an error.

const test = require('node:test')
const assert = require('node:assert/strict')

const { allowExtensionFrames } = require('../src/main/extensionFramePolicy')

// The policy WhatsApp Web actually served on 2026-09-19, trimmed to the
// directives that matter here.
const WHATSAPP_POLICY =
  "default-src 'self' blob:; script-src blob: 'self' 'nonce-abc'; " +
  "child-src 'self' blob: data:; frame-src 'self' blob: https://webtp.whatsapp.net"

test('adds the extension scheme to an existing frame-src', () => {
  const result = allowExtensionFrames(WHATSAPP_POLICY)
  assert.match(result, /frame-src [^;]*chrome-extension:/)
})

test('adds the extension scheme to child-src as well', () => {
  const result = allowExtensionFrames(WHATSAPP_POLICY)
  assert.match(result, /child-src [^;]*chrome-extension:/)
})

test('leaves unrelated directives untouched', () => {
  const result = allowExtensionFrames(WHATSAPP_POLICY)
  assert.match(result, /script-src blob: 'self' 'nonce-abc'/)
  assert.ok(!/script-src[^;]*chrome-extension:/.test(result))
})

test('is idempotent — a second pass changes nothing', () => {
  const once = allowExtensionFrames(WHATSAPP_POLICY)
  assert.equal(allowExtensionFrames(once), once)
})

test("derives a frame-src from default-src when no frame directive exists", () => {
  const result = allowExtensionFrames("default-src 'self' blob:; script-src 'self'")
  assert.match(result, /frame-src 'self' blob: chrome-extension:/)
})

test("drops 'none' rather than producing an invalid source list", () => {
  // 'none' may not share a source list with anything else: Chromium warns and
  // ignores the directive, which would silently un-apply the whole relaxation.
  const result = allowExtensionFrames("default-src 'self'; frame-src 'none'")
  assert.match(result, /frame-src chrome-extension:/)
  assert.ok(!result.includes("'none'"), `'none' survived: ${result}`)
})

test("drops 'none' when falling back through default-src", () => {
  const result = allowExtensionFrames("default-src 'none'")
  assert.match(result, /frame-src chrome-extension:/)
  assert.ok(!/frame-src[^;]*'none'/.test(result), `'none' survived: ${result}`)
})

test('handles several comma-combined policies independently', () => {
  const result = allowExtensionFrames("default-src 'self', frame-src 'none'")
  // Each policy is enforced separately by the browser, so each needs its own
  // allowance; neither may be left blocking the extension frame.
  for (const policy of result.split(',')) {
    assert.match(policy, /frame-src [^;]*chrome-extension:/, `policy not relaxed: ${policy}`)
  }
})

test('an empty policy stays empty', () => {
  assert.equal(allowExtensionFrames(''), '')
})
