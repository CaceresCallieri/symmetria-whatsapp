// Single source of truth for the window chrome geometry.
//
// The shell renderer draws the account sidebar in CSS, while the main process
// positions each account's WebContentsView in pixels. Both sides have to
// agree, so both read this number -- the renderer receives it as a CSS custom
// property rather than repeating the literal.
//
// There is no title-bar height any more. The window is frameless and
// undecorated, so an account view starts at the very top of the content area
// and Hyprland handles moving, resizing and closing it.

const SIDEBAR_WIDTH = 64

/** Bounds of the region an account's web view occupies inside the window. */
function accountViewBounds(windowContentBounds) {
  return {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, windowContentBounds.width - SIDEBAR_WIDTH),
    height: windowContentBounds.height,
  }
}

module.exports = { SIDEBAR_WIDTH, accountViewBounds }
