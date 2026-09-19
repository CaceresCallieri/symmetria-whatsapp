# Spike: Surfingkeys inside Electron on WhatsApp Web

Throwaway harness. It answers one question that gates the whole Electron
direction: **does the Surfingkeys extension load inside Electron, and does its
hint mode engage on WhatsApp Web?**

Keep this directory until the Electron app is the daily driver. It is the only
reproducible way to re-test the extension against a new Electron, a new
Surfingkeys, or a new WhatsApp Web redesign.

## Result: yes, with two required workarounds

| Question | Answer |
|----------|--------|
| Does Electron load the Surfingkeys MV3 build? | Yes. Extension id assigned, service worker runs. |
| Does the content script attach on an `https://` page? | Yes. |
| Does hint mode engage on `web.whatsapp.com`? | Yes. 8 hints over every interactive element of the login page. |
| Does the Surfingkeys UI frame render? | Yes. Its status bar ("Hints to click - 3ms / 6") draws correctly. |
| Does WhatsApp Web run at all under Electron? | Only after the user agent is overridden. See below. |

Verified on Electron 42.9.3 (Chromium 148), Surfingkeys 1.19.2,
electron-chrome-extensions 4.9.0.

## Workaround 1 — user agent

WhatsApp Web sniffs the user agent and serves an "WhatsApp works with Google
Chrome 100+" wall when it sees the `Electron/<version>` token. Overriding the
session user agent with the plain Chrome string for the embedded Chromium makes
the real app load. Without `--ua=chrome` this spike reproduces the wall.

## Workaround 2 — storage persistence

WhatsApp Web logs `storage bucket persistence denied
(aquire-persistent-storage-denied)` because Chromium refuses
`navigator.storage.persist()` without a user-engagement signal. This is the same
problem `src/ProfileSetup.h` already patches around in the Qt app, and the same
patch is needed in Electron.

## Known-dead Surfingkeys features

Electron implements only a subset of the `chrome.*` APIs, and
electron-chrome-extensions fills in `tabs`, `windows`, `commands`, `action`,
`storage`, `cookies`, `contextMenus`, `notifications` and `webNavigation`. These
Surfingkeys features have no backing API and will not work:

`bookmarks`, `history`, `downloads`, `sessions`, `topSites`, `tabGroups`, `tts`,
`proxy`, `userScripts`, `nativeMessaging`.

None of them matter in a single-site WhatsApp client. The spike confirms
Surfingkeys' service worker survives their absence: `chrome.proxy` throws a
caught `TypeError` during startup and the worker keeps running.

## Not yet answered — needs a logged-in account

The login page has no message composer and no virtualised chat list, so the spike
cannot settle the two behaviours most likely to disappoint:

1. WhatsApp's composer is `contenteditable` and takes focus when a chat opens,
   which drops Surfingkeys into pass-through. `Escape` is also bound by WhatsApp
   itself, so the two may fight.
2. The chat list is a virtualised scroller rather than the page, so `j`/`k` may
   scroll nothing until the scrollable element is targeted.

Re-run against a logged-in session to settle these.

## Running it

Needs a display. Under a headless box, use Xvfb:

```sh
Xvfb :99 -screen 0 1400x900x24 &
npm install
DISPLAY=:99 electron42 . --url=https://web.whatsapp.com --ua=chrome --settle=35000 --out=/tmp/shot.png
```

Flags: `--url`, `--ua=chrome`, `--key` (hint key, default `f`), `--settle`
(milliseconds to wait for the app shell), `--out` (screenshot path).

The harness prints a JSON report between `===SPIKE_REPORT_START===` and
`===SPIKE_REPORT_END===` and exits non-zero if any step failed.

## Rebuilding the bundled extension

`surfingkeys-ext/` is a production Chromium build of Surfingkeys. It is git-ignored
(6.6 MB of webpack output), so build it before the first run:

```sh
git clone https://github.com/brookhong/Surfingkeys /tmp/sk && cd /tmp/sk
npm install && npx webpack --mode=production --config ./config/webpack.config.js
cp -r dist/production/chrome/. <this-dir>/surfingkeys-ext/ && rm -f <this-dir>/surfingkeys-ext/sk.zip
```
