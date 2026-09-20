# Symmetria WhatsApp

Electron multi-account WhatsApp Web wrapper whose keyboard layer is the
Surfingkeys extension rather than code this project maintains. Part of the
Symmetria ecosystem.

**`docs/PRD.md` is canonical** for workarounds, architecture and open questions.
When this file or a note in `.claude/memory/` disagrees with it, the PRD wins —
correct the other file rather than acting on it.

## Branch model

- **`main` = the previous Qt6/QML implementation**, kept as a working fallback.
  Only the user decides when the Electron work replaces it; never merge into
  `main` or delete its content on your own initiative.
- **`t3code/electron-frontend-research` = the Electron app.** If
  `src/main/index.js` exists in your checkout, you are on the Electron side.
- **`origin/dev` = the abandoned native-Qt experiment.** Do not build on it.

## Stack

- **Runtime:** Electron, from the Arch package `electron`. It is a prerequisite
  of `npm start` and is not installed by `npm install`. Last verified on 42.9.3
  and 43.7.0 — on any other version, run the keyboard-layer verification below
  before trusting it.
- **Language:** JavaScript, no build step for application code
- **Keyboard layer:** Surfingkeys, loaded as a real Chrome extension via
  `electron-chrome-extensions`
- **Target:** Arch Linux, Wayland, Hyprland

## Running it

`npm run build:extension` builds Surfingkeys into `vendor/` and is required
once. `vendor/` is git-ignored, so a fresh checkout has no keyboard layer:
the app still runs, with no keyboard navigation and a warning in the sidebar.

## Key decisions

- **Electron over Qt6/QML, for the extension API and nothing else.** Qt
  WebEngine exposes no extension API at all — only user scripts, which is the
  raw-injection route this project already abandoned. That single fact drove the
  re-platform.
- **Rent the keyboard layer, never build it.** Two attempts to own it failed or
  stalled. Surfingkeys hints anything clickable generically, so it has no
  WhatsApp selector registry to rot, and its authors absorb WhatsApp's
  redesigns.
- **Never re-add DOM injection for navigation.** The test: if the code depends
  on WhatsApp's DOM *structure* — selectors, class names, `data-testid`, ARIA
  roles, element trees — it is forbidden, and this project has paid for it
  twice. Three things are not that and are fine:
  - patching browser APIs (`window.Notification`, `navigator.storage`), which
    are contracts with the browser rather than with WhatsApp;
  - reading `document.title`, the one piece of WhatsApp state with a stable
    shape, which is how the unread badge works (`src/preload/account.js`);
  - Surfingkeys touching the page DOM, because its hinting is generic and has
    no selector registry to rot.
- **Wrapper over protocol reimplementation.** Zero ban risk. This has survived
  every pivot and is not open for reconsideration.

**If a task appears to require one of these**, stop and tell the user which
prohibition it hits and what the alternative costs. Do not work around it
silently, and do not begin the work while waiting for the answer. If you are
unsure whether a change crosses one of these lines, say so and ask one question
rather than proceeding on your own reading of the rule.

## Before you change the platform

Two paths here fail **silently** — the app keeps running and the feature just
stops. Verify the one you touched.

- **The keyboard layer.** Changing the Electron package version, the pinned
  Surfingkeys ref, `electron-chrome-extensions`, `src/main/accountSession.js`,
  `src/main/extensionFramePolicy.js` or `src/preload/account.js` leaves the app
  running with the keys dead. Run `verify:keyboard`.
- **The account picture.** Changing `src/preload/account.js`,
  `src/main/accountAvatars.js`, `src/main/imageDecoding.js` or
  `src/main/notificationIcon.js` costs the sidebar button its photo, and the
  initials it falls back to are also what a correct app shows for an account
  with no photo. Run `verify:avatars`, and `verify:notifications` for the two
  image modules, which the notification avatar shares.

```sh
# shell 1 — blocks until you stop it
npm start -- --remote-debugging-port=9222

# shell 2
npm run verify:keyboard        # the keyboard layer and its two frame checks
npm run verify:notifications   # the notification path, sender avatar included
npm run verify:avatars         # the account picture, WhatsApp's IndexedDB to button
```

All three exit non-zero when a check fails, so read the exit code rather than
parsing the output.

Two of them refuse to run when a precondition is missing, and a refusal is not
a failure of your change: `verify:notifications` needs a notification daemon on
the session bus, and `verify:avatars` needs an account that is **not** logged in
(it seeds a fake id into WhatsApp's own store, and cleaning that up again would
take a real account id with it). When one refuses, say which checks ran and
which refused — never report the change as verified on the strength of a check
that refused.

**Run `verify:avatars` last.** It reloads each account page over the DevTools
protocol, and the Surfingkeys UI frame does not come back from a reload driven
that way, so `verify:keyboard` afterwards reports two frame failures that have
nothing to do with your change. Restart the app before any further check.

Stop the app when you are done. The app needs a display: on a headless machine
run it under `Xvfb` (`xvfb-run -a --server-args='-screen 0 1400x900x24' npm
start -- --remote-debugging-port=9222`).

`npm test` covers the pure functions whose failure is silent — the CSP
rewriter, the channel names the preloads have to inline, and the image caps and
decoding rules that guard what the main process will accept. See `test/` for
the current set.

`spike/surfingkeys-electron` is a lower-level harness for when the question is
whether the extension works in Electron at all, rather than whether this app
wired it up correctly; run it with
`cd spike/surfingkeys-electron && npm install && electron .`.

## Workarounds that must not be removed

Each is forced by the platform and documented at its call site.
`docs/PRD.md` §"Workarounds that the platform forces" is the canonical list with
reasons. The one thing worth knowing before you act: **the two frame-policy
workarounds fail silently.** WhatsApp refuses the Surfingkeys omnibar frame
twice over — once by CSP, once by `Cross-Origin-Embedder-Policy` — and lifting
only one leaves it blocked while hints keep working, so nothing looks broken.
