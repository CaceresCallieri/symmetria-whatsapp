---
name: Relaunch, do not build
description: The app has no build step for application code; after editing, just relaunch — but verify the keyboard layer after platform changes
type: feedback
originSessionId: 83d1884e-bab4-49c0-a88a-78d68460eefb
---
After editing application source (main process, preload, renderer), there is nothing to build — Electron loads the JavaScript directly. Tell the user to relaunch with `npm start`.

**Why:** The user does not want to run build steps by hand, and inventing a build step that does not exist wastes their time.

**How to apply:**
- Application code: no build. Just relaunch.
- `vendor/surfingkeys` is the one exception. Run `npm run build:extension` yourself when `test -d vendor/surfingkeys` fails, or when `DEFAULT_REF` in `scripts/build-surfingkeys.js` changed. Do not hand that to the user.
- Two paths fail silently and each has its own check: `npm run verify:keyboard` for the keyboard layer, `npm run verify:avatars` for the account picture. `AGENTS.md` §"Before you change the platform" lists which files trigger which, and holds the exact two-shell procedure. All of them need the app already running with `--remote-debugging-port=9222`; without it they exit with a connection error that reads like a broken script.
- `npm test` needs nothing running.

Related: [[project_frontend_pivot]], [[project_overview]].
