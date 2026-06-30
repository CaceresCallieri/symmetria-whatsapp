# Symmetria WhatsApp — Product Requirements Document

## Vision

A Qt6/QML-based WhatsApp desktop client for Arch Linux that prioritizes keyboard-first navigation and multi-account support, integrated into the Symmetria ecosystem's design language.

## Project Status & Direction (Pivot — 2026-06-30)

The original plan delivered keyboard-first navigation by **injecting JavaScript
into WhatsApp Web's live DOM** (vim-like modal nav). That approach has been
**abandoned**: WhatsApp Web dropped the `data-testid` attributes the selector
registry relied on (migrating to ARIA roles), and the injection had to fight the
platform at every layer (a QML `Shortcut` bridge just to capture `Tab`, stacked
`keydown`/`keypress`/`beforeinput` handlers to suppress typing in
`contentEditable`). Every WhatsApp redesign silently broke it — an unwinnable
maintenance treadmill as a guest in someone else's React app.

**New direction:** keyboard-first UX moves out of injected JS and into a
**native, keyboard-driven Qt frontend** that renders WhatsApp data directly and
treats WhatsApp purely as a data/transport backend (a far more stable contract).

**Branch model:**
- **`main` = stable.** The clean multi-account WhatsApp Web wrapper (Phase 1),
  with the JS-injection nav layer removed. Always usable.
- **`dev` = experimental.** Where the native Qt frontend (Phase 2) is built. It
  is promoted to `main` only once it is feature-complete enough to be the daily
  driver.

The Phase 2 backend architecture (how the native UI sources WhatsApp data) is
**under active evaluation** — see Phase 2 below. No approach is committed yet.

## Problem Statement

Existing WhatsApp desktop experiences fail on three fronts:
1. **No multi-account support** — The official client and most wrappers support only one account
2. **Mouse-dependent navigation** — Chat selection, message actions, and file management all require mouse interaction
3. **No visual integration** — Generic Electron/GTK wrappers don't match custom desktop environments

## Target User

Power user running Arch Linux + Hyprland with keyboard-driven workflows who uses WhatsApp daily across multiple accounts (work + personal).

---

## Phase 1 — WebView Wrapper (Stable Baseline — shipped on `main`)

This is the clean, usable multi-account wrapper that lives on `main`. The
JS-injection keyboard navigation that was originally specced here (P0-5) has
been removed; keyboard-first UX is now a Phase 2 goal (native frontend).

### Core Requirements

#### P0 — Must Have

| ID | Requirement | Details |
|----|-------------|---------|
| P0-1 | **Multi-account support** | Minimum 2 accounts with fully isolated sessions via `QWebEngineProfile`. Each account has independent cookies, localStorage, and login state. |
| P0-2 | **Account switching UI** | Sidebar or tab bar to switch between accounts. Visual indicator showing which account is active. Unread badge count per account. |
| P0-3 | **WhatsApp Web rendering** | Load `https://web.whatsapp.com` in `WebEngineView` with full feature parity: messaging, media playback, file upload/download, voice messages, video/audio calls. |
| P0-4 | **Session persistence** | QR code login persists across app restarts. Each account's session stored independently under `~/.local/share/symmetria-whatsapp/<account-name>/`. |
| P0-5 | **Wayland/Hyprland compatibility** | Native Wayland rendering via `qt6-wayland`. Proper window class for Hyprland rules. |

#### P1 — Should Have

| ID | Requirement | Details |
|----|-------------|---------|
| P1-1 | **System tray** | StatusNotifierItem integration with per-account unread counts. Minimize-to-tray. |
| P1-2 | **Native notifications** | Intercept WebEngine notifications and forward via D-Bus (`org.freedesktop.Notifications`) to the Symmetria Shell notification center. Per-account notification grouping. |
| P1-3 | **Symmetria styling** | Custom frameless window with title bar matching Symmetria design language. Consistent color palette, fonts, and border radius. |
| P1-4 | **Zoom controls** | Per-account zoom level with persistence. |
| P1-5 | **Account management** | Add, remove, rename, and reorder accounts. |

#### P2 — Nice to Have

| ID | Requirement | Details |
|----|-------------|---------|
| P2-1 | **Custom CSS injection** | Per-account theme customization via user-provided CSS files. |
| P2-2 | **Download manager** | Intercept file downloads and manage them in a custom UI with configurable save path. |
| P2-3 | **Do Not Disturb** | Suppress notifications per-account or globally. |
| P2-4 | **Quick account switcher** | Keyboard shortcut (e.g., `Ctrl+1`/`Ctrl+2`) to jump between accounts. |
| P2-5 | **Start minimized** | CLI flag `--minimized` to start in system tray. |
| P2-6 | **Auto-launch** | Systemd user unit or XDG autostart entry. |

### Technical Architecture

```
symmetria-whatsapp/
├── CMakeLists.txt
├── src/
│   ├── main.cpp                 # App entry, WebEngine init
│   ├── ProfileSetup.h           # Per-account QWebEngineProfile singletons
│   ├── NotificationHandler.h    # WebEngine → D-Bus notification forwarding
│   ├── DownloadHandler.h        # File download interception
│   └── qml/
│       ├── Main.qml             # Root window, account sidebar, shortcuts
│       ├── AccountView.qml      # WebEngineView per account
│       ├── AccountSidebar.qml   # Account list with badges
│       └── TitleBar.qml         # Custom frameless title bar
├── resources/
│   └── icons/                   # App icons
├── docs/
│   ├── PRD.md
│   └── feature-ideas/           # Researched-but-unbuilt feature parking lot
└── CLAUDE.md
```

**Key dependencies:**
- `qt6-webengine` — Chromium-based web rendering
- `qt6-declarative` — QML engine
- `qt6-wayland` — Wayland platform plugin
- `qt6-svg` — SVG icon support

### Success Criteria (Phase 1)

1. Two WhatsApp accounts running simultaneously with independent sessions
2. Switch between accounts in under 500ms (incl. `Ctrl+1/2`, `Ctrl+Tab`)
3. Notifications appear in the Symmetria Shell notification center grouped by account
4. App uses less RAM than two separate browser tabs (~400MB total for 2 accounts)
5. Window matches Symmetria design language

> Full keyboard-driven chat navigation is intentionally **not** a Phase 1
> criterion anymore — it moved to Phase 2 (native frontend).

---

## Phase 2 — Native Keyboard-Driven Frontend (in development on `dev`)

This is the heart of the pivot and the project's real long-term goal.

### Vision

A **native Qt/QML frontend** that renders WhatsApp data directly and is
keyboard-driven by design — no injected JS, no scraping a foreign UI to fake
navigation. WhatsApp becomes a *data/transport backend*; the UI is entirely
ours, so every element is reachable by keyboard because we built it that way.

### Architecture — DECIDED: HYBRID (2026-06-30 research spike)

A fact-checked research spike (19 sources, 25 claims adversarially verified —
17 confirmed, 8 refuted) compared the four candidates on ban-risk (weighted
heaviest), latency, E2E encryption, Qt-integration effort, and maintenance.
**Winner: HYBRID** — a native Qt/QML UI on top of an embedded real WhatsApp Web
instance in a `QWebEngineView`, with data read out and actions sent in over a
**minimal, targeted `QWebChannel` bridge**.

| Approach | Ban risk (heaviest) | Extra runtime | E2E encryption | Maintenance | Verdict |
|----------|---------------------|---------------|----------------|-------------|---------|
| **HYBRID** — native UI + embedded WhatsApp Web engine, `QWebChannel` bridge | **Lowest** — runs the genuine official client (Meta itself ships its desktop app as a Chromium WebView of web.whatsapp.com) | None (all-Qt) | Preserved (decrypt in-process) | Bridge stability vs. DOM is the only real risk; surface can stay small | **CHOSEN** |
| whatsapp-web.js / WPPConnect | Real, maintainer-admitted ("shouldn't be considered totally safe") | Node.js | Local (ok) | **Severe** — scrapes WhatsApp's internal webpack Store; breaks completely on internal changes | No |
| Matrix bridge (`mautrix-whatsapp` / `whatsmeow`) | `whatsmeow` flagged "account at risk" since May 2025 | Homeserver + bridge + Postgres | **Fails** — "end-to-bridge", not end-to-end | Low (mature) but heaviest infra | No |
| Baileys (direct protocol) | **Highest, best-documented** — Oct 2025 ban wave hit 3+ yr-old bots, version-agnostic | Node.js | Local (ok) | High | No |

**Why HYBRID wins:** lowest ban risk on the heaviest-weighted dimension (it *is*
the official web client, not a reimplementation), it's the only non-Matrix option
that cleanly preserves E2E (decryption stays inside the official engine), it adds
no new runtime, and it **reuses the existing multi-account `QWebEngineProfile`
infrastructure already on `main`** — Phase 2 builds a native UI on top of the
Phase 1 wrapper rather than replacing it.

**Cited ban-risk evidence (2025–2026):**
- Baileys ban wave — https://github.com/WhiskeySockets/Baileys/issues/1869
- whatsmeow "account at risk" warnings — https://github.com/tulir/whatsmeow/issues/810
- whatsapp-web.js disablements + maintainer warning — https://github.com/pedroslopez/whatsapp-web.js
- Qt `QWebChannel` JS↔C++ bridge (mechanism) — https://doc.qt.io/qt-6/qtwebchannel-javascript.html

**Caveats carried forward (verified, not hand-waved):**
1. **Bridge stability is HYBRID's one real unknown** — it still reads from
   WhatsApp Web's DOM, so it inherits a DOM-fragility risk. The mitigation (and
   the lesson from the abandoned injection nav) is a *minimal, targeted* read
   surface — not whatsapp-web.js's full internal-Store reconstruction. A thin
   spike validates this before the full frontend is built.
2. **Latency was never benchmarked** by any source — HYBRID rides the same
   real-time socket as the official client so it should match it, but that's
   inference.
3. **Ban-risk is fast-moving** (enforcement intensified into 2026) — re-check
   before any long-term commitment. "Lowest" ban risk, **not** guaranteed zero
   (the "zero ban risk" framing was explicitly refuted in verification).
4. Running two accounts as two embedded profiles is already the Phase 1 status
   quo (two officially-supported linked-device web sessions); HYBRID changes the
   UI layer, not that.

### Target Keyboard Model

The vim-like model originally specced for Phase 1 is preserved here as the
**design target for the native frontend** (it's now achievable cleanly because
we own every widget, rather than intercepting a foreign DOM):

**Modes**

| Mode | Activation | Behavior |
|------|------------|----------|
| **Normal** | `Escape` from any mode | Navigate chats and messages without typing |
| **Insert** | `i` or `Enter` on chat | Focus message input, type naturally |
| **Command** | `:` in Normal mode | Execute commands (`:search`, `:archive`, `:mute`, etc.) |

**Normal mode** — `j`/`k` next/prev chat · `Enter` open chat + Insert ·
`Escape` back to list · `gg`/`G` first/last · `/` search · `Ctrl+D`/`Ctrl+U`
half-page scroll · `r` reply · `e` react · `y` copy · `gd` download attachment ·
`Ctrl+1..9` switch account · `Tab` cycle accounts.

**Insert mode** — `Escape` to Normal · `Enter` send · `Shift+Enter` newline ·
`Ctrl+B/I/S` bold/italic/strikethrough.

### Phase 2 Requirements (Draft)

- Full message list rendered in native QML (not webview)
- Keyboard navigation (model above) across all UI elements
- Inline media preview and playback
- Message search with fuzzy matching
- Contact/group management via keyboard
- File browser for attachments
- Custom notification actions (reply from notification)
- Message threading and pinning
- Read/unread management

### Open Questions (backend choice now RESOLVED — HYBRID)

- **Bridge stability (the decisive unknown) — INITIAL VALIDATION PASSED.** A thin
  spike on `dev` (`WhatsAppBridge` + `whatsapp-bridge.js`) read the live chat list
  out of WhatsApp Web through `QWebChannel` into a native QML `ListView` — 70
  chats, updating live. Key finding: WhatsApp Web's chat list is now an ARIA grid
  (`[role="grid"] > [role="row"]`); the old `[role="listitem"]` matches 0. A small
  *ranked selector list* adapted automatically — i.e. a minimal, targeted read
  surface survives the exact DOM migration that broke the removed injection nav.
- **Action surface (sending) — WIRED, live-confirm pending.** The reverse
  direction is built: native input → `requestSend()` → `sendRequested` signal →
  page `doSend()` (focuses compose box, `execCommand("insertText")`, optional
  send). Handler registration verified on both profiles with no errors; the live
  insert/send into an open chat is the remaining interactive check.
- Still open: long-run breakage frequency of the read/action surfaces; behavior
  across all message types (media, replies, voice); multi-account action routing.
- What is the minimal data surface to read (chat list, active conversation
  messages, unread counts) and the minimal action surface to send (select chat,
  send message)?
- Measured message-delivery latency of the bridge path (no source benchmarked
  this — verify empirically once the spike works).
- Does the embedded WhatsApp Web view stay visible (for fallback) or run hidden
  behind the native UI in the final design?

---

## Non-Goals

- Mobile support
- Cross-platform (Windows/macOS) — Arch Linux only
- WhatsApp Business API integration
- Bot or automation features
- Replacing WhatsApp's E2E encryption

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp blocks non-standard user agents | Low | Use standard Chromium UA (Qt WebEngine does this by default) |
| Phase 2 data bridge breaks when WhatsApp Web changes (hybrid path) | Medium | Read a minimal, stable data surface — not the full DOM; this is the lesson from the abandoned injection approach |
| Account ban (Phase 2, depends on chosen backend) | High | Prefer a backend that runs the real web client (hybrid / whatsapp-web.js) over raw-protocol (Baileys); develop with a secondary number. Final mitigation set follows the architecture research. |
| Qt WebEngine Wayland bugs | Low | Qt 6.8+ has resolved most issues; fallback flags available |

> The original "WhatsApp DOM changes break keyboard nav" risk is **retired** —
> the JS-injection nav that carried it has been removed (see Project Status).
