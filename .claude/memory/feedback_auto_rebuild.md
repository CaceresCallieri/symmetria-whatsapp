---
name: Relaunch, do not ask the user to build
description: The app has no build step for application code; after editing, just tell the user to relaunch
type: feedback
originSessionId: 83d1884e-bab4-49c0-a88a-78d68460eefb
---
After editing application source (main process, preload, renderer), there is nothing to build — Electron loads the JavaScript directly. Tell the user to relaunch with `npm start`.

**Why:** The user does not want to run build steps by hand. Under the previous Qt implementation this meant always running `cmake --build build` for them; on Electron the equivalent obligation is simply not to invent a build step that does not exist.

**How to apply:**
- Application code: no build. Just relaunch.
- `vendor/surfingkeys` is the one exception. It is git-ignored and produced by `npm run build:extension`. Run that yourself when the extension is missing or its pinned ref changed — do not hand it to the user.
- After touching anything that could break the keyboard layer silently, run `scripts/verify-keyboard-layer.js` before reporting success.

Related: [[project_frontend_pivot]], [[symmetria-whatsapp-overview]].
