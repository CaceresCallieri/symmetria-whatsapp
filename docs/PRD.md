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

### Architecture — UNDER EVALUATION (research-first, nothing committed)

The pivotal open decision is **how the native UI sources WhatsApp data**. This
choice sets the ban-risk, dependency, latency, and maintenance profile, so it
will be settled by a focused research spike before any backend code is written.
Candidate approaches and their honest trade-offs:

| Approach | Ban risk | Extra runtime | Maintenance | Notes |
|----------|----------|---------------|-------------|-------|
| **Hybrid** — native UI + embedded WhatsApp Web as a hidden engine; bridge data in/actions out (QWebChannel / targeted JS) | None (it *is* the official web client) | None (stays all-Qt) | Medium — still reads from WhatsApp's DOM, but reading data is far more stable than faking nav | Preserves the project's #1 principle (zero ban risk) and reuses the existing multi-account profile infra |
| **whatsapp-web.js / WPPConnect backend** — headless Node drives real WhatsApp Web, exposes a clean RPC/event API over a local socket; Qt is a pure native client | Low | Node.js | Low–Medium — community library absorbs WhatsApp's DOM churn | Cleanest separation; native UI fully under our control |
| **Matrix bridge (`mautrix-whatsapp`)** + native Qt Matrix client | Low–Moderate (bridge uses `whatsmeow`) | Matrix homeserver + bridge | Low (mature stack) | Heaviest infra to run/maintain for a single-user desktop app; was the previous PRD pick |
| **Baileys (direct protocol)** + native UI | High (non-official client signature) | Node.js | High | Fastest/lightest at runtime, but ToS-ban exposure makes it a poor fit for a daily-driver account |

**Decision status:** pending research. The research spike must compare these on
current (2026) ban-risk reality, message-delivery latency, E2E-encryption
handling, Qt integration effort, and ongoing maintenance burden, then recommend
one. Until then, the docs describe the direction, not the implementation.

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

### Research Agenda / Open Questions

- **Backend choice (blocking):** which of the four approaches above wins on the
  ban-risk / latency / encryption / effort / maintenance matrix?
- For the hybrid path: how stable is reading WhatsApp Web state via QWebChannel
  vs. the old DOM-injection fragility? What's the minimal, change-resilient
  data surface to read?
- Can E2E encryption be preserved end-to-end for each candidate?
- What is the acceptable message-delivery latency, and which approaches meet it?
- Does Phase 2 stay one app (webview hidden behind native UI) or split into a
  backend process + native client?

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
