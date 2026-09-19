// Single source of truth for the window chrome geometry.
//
// The shell renderer draws the title bar and the account sidebar in CSS, while
// the main process positions each account's WebContentsView in pixels. Both
// sides have to agree, so both read these numbers -- the renderer receives them
// as CSS custom properties rather than repeating the literals.

const TITLE_BAR_HEIGHT = 36
const SIDEBAR_WIDTH = 64

/** Bounds of the region an account's web view occupies inside the window. */
function accountViewBounds(windowContentBounds) {
  return {
    x: SIDEBAR_WIDTH,
    y: TITLE_BAR_HEIGHT,
    width: Math.max(0, windowContentBounds.width - SIDEBAR_WIDTH),
    height: Math.max(0, windowContentBounds.height - TITLE_BAR_HEIGHT),
  }
}

module.exports = { TITLE_BAR_HEIGHT, SIDEBAR_WIDTH, accountViewBounds }
