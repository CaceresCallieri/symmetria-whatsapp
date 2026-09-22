# Symmetria WhatsApp — Product Requirements Document

## Vision

A multi-account WhatsApp desktop client for Arch Linux that is driven from the
keyboard and matches the Symmetria ecosystem's design language.

## Project status and direction

The project has pivoted twice. Both pivots were about the same question — how to
get vim-style keyboard navigation without an unmaintainable amount of work — and
the current answer is the first one that does not require the project to build
and maintain a keyboard layer at all.

### Pivot 1 (2026-06-30) — away from JS injection

Keyboard navigation was originally delivered by injecting JavaScript into
WhatsApp Web's live DOM. It was abandoned: WhatsApp dropped the `data-testid`
attributes the selector registry depended on, and intercepting keys inside a
foreign React application needed stacked hacks. Every WhatsApp redesign broke
it. The plan became a native Qt frontend that treats WhatsApp as a data backend.

### Pivot 2 (current) — away from a native frontend, to Electron plus Surfingkeys

A native frontend solved the maintenance problem by discarding WhatsApp's own UI
entirely, but it required choosing a backend to source WhatsApp data from, and
every candidate carried either ban risk, heavy infrastructure, or a large
dependency. That decision had blocked the project.

The current direction avoids the question. The app stays a WhatsApp Web wrapper,
and the keyboard layer is **rented from the Surfingkeys extension** rather than
built. Surfingkeys hints anything clickable generically -- it has no WhatsApp
selector registry to rot -- and its authors maintain it.

This is only possible on Electron. **Qt WebEngine exposes no extension API at
all**, only user scripts, which is the raw-injection route pivot 1 abandoned.
That single fact is the reason the application was re-platformed from Qt6/QML to
Electron, and it is the only reason. Everything else about the two stacks was
close enough not to matter.

The re-platform is validated, not assumed. See `spike/surfingkeys-electron`.

**Branch model:** `main` is the Electron application. The Qt implementation it
replaced is retired rather than deleted — it is the history behind `main`, at
the tag `qt6-final`, and the abandoned native-Qt experiment is at
`native-qt-experiment`. Read either for context; build on neither.

## Problem statement

Existing WhatsApp desktop experiences fail on three fronts:

1. **No multi-account support.** The official client and most wrappers handle
   one account.
2. **Mouse-dependent navigation.** Chat selection, message actions and file
   management all need the mouse.
3. **No visual integration.** Generic wrappers do not match a custom desktop.

## Target user

A power user on Arch Linux and Hyprland with a keyboard-driven workflow, who
uses WhatsApp daily across a work number and a personal number.

---

## Architecture

```
src/
├── main/                     Electron main process
│   ├── index.js              entry, window, IPC, account activation
│   ├── accounts.js           account list persistence
│   ├── accountSession.js     per-account session: partition, UA, permissions
│   ├── accountViews.js       one WebContentsView per account, show/hide, layout
│   ├── downloads.js          the save dialog, and announcing what it saved
│   ├── extensions.js         Surfingkeys loading per session
│   ├── externalLinks.js      scheme filter for page-supplied URLs
│   ├── extensionFramePolicy.js  CSP and cross-origin-isolation relaxations for the extension frame
│   ├── notifications.js      web notifications to the desktop daemon
│   ├── notificationIcon.js   the page-supplied sender avatar, as a NativeImage
│   ├── accountAvatars.js     the account's sidebar picture: source, cache and IPC
│   ├── imageDecoding.js      the pixel cap both image decoders share
│   ├── shortcuts.js          account-switching keys
│   └── layout.js             window geometry, shared with the renderer
├── preload/
│   ├── shell.js              IPC surface for the app chrome
│   └── account.js            main-world patches inside WhatsApp Web
├── shared/
│   └── channels.js           IPC channel names, used by main and both preloads
└── renderer/                 the app chrome: the account sidebar

test/                         node --test suite (npm test)
scripts/                      build and verification harnesses, driven from
                              outside the app so it carries no test hooks
```

The window is a frameless, undecorated, transparent `BrowserWindow`. Its own
renderer draws the account sidebar and never loads remote content, so it stays
a trusted context. Each account's WhatsApp Web lives in a `WebContentsView`
stacked into the same window and positioned from `layout.js`.

There is no title bar. Hyprland already moves, resizes and closes windows from
the keyboard, so a drawn bar only cost a strip of height and duplicated the
compositor. Removing it also removed the `WINDOW_ACTION` and `WINDOW_STATE`
channels and the window-control buttons, which had no other caller.

### Key decisions

- **Electron over Qt6/QML** — for the extension API, and nothing else. See
  "Pivot 2" above.
- **Wrapper over protocol reimplementation** — zero ban risk, proven approach.
  This has survived both pivots and is the project's most durable decision.
- **Rented keyboard layer over a built one** — a third party absorbs WhatsApp's
  redesigns. This is the whole point of the current direction.
- **One session partition per account** — `persist:account-<id>` gives each
  account isolated cookies, storage and login state. It is the direct
  equivalent of the `QWebEngineProfile` arrangement, with less ceremony.
- **All accounts stay loaded** — WhatsApp Web must stay connected to deliver
  notifications for an account you are not looking at, so switching accounts
  only re-stacks views and is therefore instant.
- **The sidebar is translucent, and its opacity is not a free choice.**
  `rgba(0, 0, 0, 0.6)` in `shell.css` restates `background = #000000` with
  `background-opacity = 0.6` from the ghostty config in the operator's
  dotfiles, so the two surfaces read as one on the desktop. A change to either
  belongs in both. Transparency needs three things together and fails silently
  if any one is missing: `transparent: true` on the window, which can only be
  set at creation; a `backgroundColor` carrying alpha; and a transparent
  `<body>` in the renderer.
- **Browser-API patches, never markup patches** — `src/preload/account.js`
  replaces `window.Notification` and `navigator.storage`, which are contracts
  with the browser. It reads no WhatsApp markup. That distinction is what
  separates the current approach from the one pivot 1 abandoned.
- **An account's own profile picture is read from WhatsApp's IndexedDB, never
  from its markup.** Decided by the operator, because it is the one place this
  project accepts a dependency on a WhatsApp internal. The alternatives were
  worse: a DOM selector is banned outright, and WhatsApp's internal webpack
  modules are renamed far more often than its storage is migrated. The shape,
  confirmed against a logged-in profile:

  | Where | What |
  |---|---|
  | `localStorage['last-wid-md']` | the account's own id, JSON-quoted, as `<account>:<device>@c.us` |
  | database `model-storage` | version 2040 at the time of writing, so it does migrate |
  | object store `profile-pic-thumb` | keyed by `<account>@c.us`, without the device suffix |
  | field `previewEurl` | a `pps.whatsapp.net` address the page can fetch; about 2 KB of JPEG |
  | field `filehash` | changes when the user changes their photo, so the poll costs one local read and fetches only on a change |

  The cost is bounded by design. Every step fails soft, and a miss anywhere
  costs the sidebar button its picture and nothing else -- it falls back to
  the account's initials, which is also what a correct app shows for an
  account with no photo. `npm run verify:avatars` is what makes that failure
  visible instead of silent.

### Workarounds that the platform forces

Each of these is a real constraint, not a preference. They are listed here
because a future agent will otherwise try to remove them.

| Workaround | Why it exists | Where |
|---|---|---|
| User agent reports plain Chrome | WhatsApp Web serves an "update Google Chrome" wall when it sees the `Electron/<version>` token | `accountSession.js` |
| `chrome-extension:` added to the page CSP frame directives | Real Chrome exempts extension frames from page CSP; Electron does not, so WhatsApp's CSP refuses the Surfingkeys omnibar frame | `extensionFramePolicy.js` |
| Cross-origin isolation opt-in written onto extension frame responses | WhatsApp sends `Cross-Origin-Embedder-Policy: require-corp`, which refuses any embedded document that does not opt in. Lifting the CSP alone is not enough. WhatsApp's own isolation is untouched — the page still reports `crossOriginIsolated` and keeps `SharedArrayBuffer` | `extensionFramePolicy.js` |
| `navigator.storage.persist` forced to resolve true | Chromium denies persistence without a user-engagement signal a wrapper never collects | `preload/account.js` |
| `window.Notification` replaced | Chromium would show notifications itself, losing the account name and giving the click nowhere to go | `preload/account.js` |
| `will-download` deliberately never calls `item.setSavePath()` | Leaving the path unset is the only way to make Electron raise a save dialog, and the dialog is what reaches the XDG portal. Setting the path is not a missing line, it is the rejected behaviour | `main/downloads.js` |
| The sender avatar is read into a data URL inside the page | WhatsApp passes it as a `blob:` URL, which exists only in that renderer. Sending the URL for the main process to fetch instead would let a page name an address for a privileged process to request | `preload/account.js`, `main/notificationIcon.js` |

### Known limits of the rented keyboard layer

Electron implements only a subset of the `chrome.*` APIs.
`electron-chrome-extensions` adds `tabs`, `windows`, `commands`, `action`,
`storage`, `cookies`, `contextMenus`, `notifications` and `webNavigation`.
Surfingkeys features backed by `bookmarks`, `history`, `downloads`, `sessions`,
`topSites`, `tabGroups`, `tts`, `proxy`, `userScripts` or `nativeMessaging` have
no backing API and do nothing. None of them mean anything in a single-site
client.

Surfingkeys' configuration lives in `chrome.storage.local`, which is per-session
and therefore per-account. A keybinding changed inside one account does not
follow to the others.

### Dependencies

- `electron` — Arch package `electron` (verified on 42.9.3 and 43.7.0)
- `electron-chrome-extensions` — GPL-3.0, matching this repository's licence.
  Any other licence requires the author's patron licence.
- Surfingkeys — built from source by `npm run build:extension`, pinned in
  `scripts/build-surfingkeys.js`

---

## Requirements

### P0 — must have

| ID | Requirement | Status |
|----|-------------|--------|
| P0-1 | Multi-account with fully isolated sessions | Done |
| P0-2 | Account switching UI with an active indicator and unread badges | Done |
| P0-3 | WhatsApp Web rendering with full feature parity | Done |
| P0-4 | Session persistence across restarts | Done |
| P0-5 | Wayland and Hyprland compatibility | Done — native since Electron 38.2 |
| P0-6 | Vim-style keyboard navigation inside a conversation | Delivered by Surfingkeys; unverified against a logged-in account |

### P1 — should have

| ID | Requirement | Status |
|----|-------------|--------|
| P1-1 | Native notifications forwarded to the Symmetria Shell notification center | Done, default click action only |
| P1-2 | Symmetria styling: frameless, undecorated, translucent sidebar | Done |
| P1-3 | Account management: add, remove, rename, reorder | Not started — edit `accounts.json` by hand |
| P1-4 | Quick account switcher: `Ctrl+1`..`Ctrl+9`, `Ctrl+Tab` | Done |
| P1-5 | Download handling with a configurable save path | Done — every download asks, through the XDG desktop portal, so the save dialog is the desktop's own file chooser. The suggested name is collision-safe. A finished download raises a desktop notification whose click reveals the file. No stored setting, and none is wanted: the dialog is the configuration |
| P1-6 | System tray with per-account unread counts, minimize to tray | Not started |
| P1-7 | Per-account zoom with persistence | Not started |
| P1-8 | Round account buttons showing each account's profile picture | Done — read from WhatsApp's IndexedDB and cached to disk, with an `avatar` path in `accounts.json` as an override. Verified by `npm run verify:avatars` |

### P2 — nice to have

| ID | Requirement | Status |
|----|-------------|--------|
| P2-1 | Inline reply from a notification | Blocked — Electron registers only a `default` action on Linux, so this needs raw D-Bus |
| P2-6 | Sender avatar in notifications | Done — verified onto the D-Bus wire by `npm run verify:notifications` |
| P2-7 | The photo itself previewed in a notification | Unmeasured — needs a logged-in account to see whether WhatsApp puts anything but the avatar in `options.icon`. If it does not, the image would have to come from WhatsApp's own DOM or storage, which is the prohibited route |
| P2-2 | Do Not Disturb, per account or global | Not started |
| P2-3 | Shared Surfingkeys configuration across accounts | Not started |
| P2-4 | Per-account custom CSS | Not started |
| P2-5 | Start minimized, and an autostart entry | Not started |

## Success criteria

1. Two accounts run at once with independent sessions.
2. Switching accounts takes under 500 ms, by click or by `Ctrl+1`/`Ctrl+2`.
3. Notifications reach the Symmetria Shell notification center, named by
   account, and clicking one focuses that account.
4. Chat navigation, message actions and link following are all reachable from
   the keyboard.
5. The window matches the Symmetria design language.

---

## Open questions

**The one that matters: does Surfingkeys hold up inside a real conversation?**
The spike proved hint mode engages on WhatsApp Web, but it could only reach the
login page. Two behaviours are still unmeasured and both could disappoint:

1. WhatsApp's composer is `contenteditable` and takes focus when a chat opens,
   which drops Surfingkeys into pass-through. WhatsApp also binds `Escape`, so
   returning to normal mode may fight the application.
2. The chat list is a virtualised scroller rather than the page, so `j`/`k` may
   scroll nothing until the scrollable element is targeted.

If either is bad enough, the fallback is a Surfingkeys configuration shipped
with the app that remaps around the conflict -- configuration, not code, and
still not a maintenance treadmill.

**Does WhatsApp offer a media preview at all?** `options.icon` carries the
sender's avatar and the app now forwards it. Whether a photo message puts the
photo there instead, or just falls back to the avatar with a "📷 Photo" body,
has never been observed -- the spike and every verification run since have only
ever reached the login page. One real message answers it.

**Notification actions.** Electron's `Notification` exposes no actions on Linux,
so replying from a notification needs `org.freedesktop.Notifications` spoken
directly over D-Bus, the way the Qt `NotificationHandler` did. The logic
translates almost unchanged; it needs a Node D-Bus dependency.

---

## Non-goals

- Mobile support
- Windows and macOS — Arch Linux only
- WhatsApp Business API integration
- Bots and automation
- Replacing WhatsApp's end-to-end encryption
- **Reimplementing the WhatsApp protocol, or sourcing WhatsApp data by any route
  other than the official web client.** This is what makes the ban risk zero,
  and it is the decision that has survived every pivot.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Surfingkeys disappoints inside a real conversation | High — it is the reason for the whole re-platform | Measure it against a logged-in account before promoting to `main`; fall back to a shipped Surfingkeys configuration |
| WhatsApp Web changes its user-agent sniffing | Medium | `scripts/verify-keyboard-layer.js` catches it; the wall is loud, not silent |
| WhatsApp Web changes its CSP shape | Medium | The rewrite handles a missing `frame-src` by deriving one from `default-src`; the verification script asserts the frame renders |
| WhatsApp tightens cross-origin isolation further | Medium | Both gates already fail *silently* — hints keep working while the omnibar does not — so the verification script checks the frame has a live document, not just an element |
| `electron-chrome-extensions` stops being maintained | Medium | GPL-3.0, so it can be forked. It is the only hard dependency of the keyboard layer |
| Surfingkeys drops Manifest V2 or V3 support Electron lacks | Low | The build is pinned to a known-good ref; raise it deliberately and re-run the spike |
| Account ban | Very low | The app runs the official web client unmodified |
