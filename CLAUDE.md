# Symmetria WhatsApp

Electron multi-account WhatsApp Web wrapper whose keyboard layer is the
Surfingkeys extension rather than code this project maintains. Part of the
Symmetria ecosystem. See `docs/PRD.md` for the full vision and the two pivots
that led here.

## Branch model

- **`main` = the previous Qt6/QML implementation.** Kept as a working fallback
  until the Electron app has been a daily driver.
- **This branch = the Electron app.** The Qt sources are removed here.

## Stack

- **Runtime:** Electron (Arch package `electron`; verified on 42.9.3 and 43.7.0)
- **Language:** JavaScript, no build step for application code
- **Keyboard layer:** Surfingkeys, loaded as a real Chrome extension via
  `electron-chrome-extensions`
- **Target:** Arch Linux, Wayland, Hyprland

## Running it

```sh
npm install
npm run build:extension   # builds Surfingkeys into vendor/, required once
npm start
```

Without `build:extension` the app still runs, but with no keyboard navigation
and a warning in the sidebar.

## Key decisions

- **Electron over Qt6/QML, for the extension API and nothing else.** Qt
  WebEngine exposes no extension API at all — only user scripts, which is the
  raw-injection route this project already abandoned. That single fact drove the
  re-platform.
- **Rent the keyboard layer, never build it.** Two attempts to own it failed or
  stalled. Surfingkeys hints anything clickable generically, so it has no
  WhatsApp selector registry to rot, and its authors absorb WhatsApp's
  redesigns.
- **Never re-add DOM injection for navigation.** Reading or driving WhatsApp's
  own markup is the failure mode this project has already paid for twice.
  Patching browser APIs (`window.Notification`, `navigator.storage`) is a
  different thing and is fine: those are contracts with the browser, not with
  WhatsApp.
- **Wrapper over protocol reimplementation.** Zero ban risk. This has survived
  every pivot and is not open for reconsideration.

## Before you change the platform

Upgrading Electron, Surfingkeys or `electron-chrome-extensions` can break the
keyboard layer **silently** — the app runs, and keys simply stop working. Two
harnesses exist to catch it, and both should be run after any such upgrade:

```sh
npm start -- --remote-debugging-port=9222   # then, in another shell:
node scripts/verify-keyboard-layer.js
```

`spike/surfingkeys-electron` is the lower-level harness, for when the question
is whether the extension works in Electron at all rather than whether this app
wired it up correctly.

## Workarounds that must not be removed

Each is forced by the platform and documented at its call site. `docs/PRD.md`
has the full table with reasons.

- Plain-Chrome user agent — WhatsApp walls off the `Electron/` token.
- `chrome-extension:` added to the page CSP frame directives — real Chrome
  exempts extension frames from page CSP, Electron does not, and without this
  the Surfingkeys omnibar silently never renders.
- `navigator.storage.persist` forced to resolve true.
