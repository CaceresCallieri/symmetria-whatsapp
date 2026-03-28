# Symmetria WhatsApp — Product Requirements Document

## Vision

A Qt6/QML-based WhatsApp desktop client for Arch Linux that prioritizes keyboard-first navigation and multi-account support, integrated into the Symmetria ecosystem's design language.

## Problem Statement

Existing WhatsApp desktop experiences fail on three fronts:
1. **No multi-account support** — The official client and most wrappers support only one account
2. **Mouse-dependent navigation** — Chat selection, message actions, and file management all require mouse interaction
3. **No visual integration** — Generic Electron/GTK wrappers don't match custom desktop environments

## Target User

Power user running Arch Linux + Hyprland with keyboard-driven workflows who uses WhatsApp daily across multiple accounts (work + personal).

---

## Phase 1 — WebView Wrapper (MVP)

### Core Requirements

#### P0 — Must Have

| ID | Requirement | Details |
|----|-------------|---------|
| P0-1 | **Multi-account support** | Minimum 2 accounts with fully isolated sessions via `QWebEngineProfile`. Each account has independent cookies, localStorage, and login state. |
| P0-2 | **Account switching UI** | Sidebar or tab bar to switch between accounts. Visual indicator showing which account is active. Unread badge count per account. |
| P0-3 | **WhatsApp Web rendering** | Load `https://web.whatsapp.com` in `WebEngineView` with full feature parity: messaging, media playback, file upload/download, voice messages, video/audio calls. |
| P0-4 | **Session persistence** | QR code login persists across app restarts. Each account's session stored independently under `~/.local/share/symmetria-whatsapp/<account-name>/`. |
| P0-5 | **Keyboard navigation layer** | JavaScript injection providing vim-like modal navigation (Normal/Insert/Command modes) for chat list traversal, message selection, and common actions. |
| P0-6 | **Wayland/Hyprland compatibility** | Native Wayland rendering via `qt6-wayland`. Proper window class for Hyprland rules. |

#### P1 — Should Have

| ID | Requirement | Details |
|----|-------------|---------|
| P1-1 | **System tray** | StatusNotifierItem integration with per-account unread counts. Minimize-to-tray. |
| P1-2 | **Native notifications** | Intercept WebEngine notifications and forward via D-Bus (`org.freedesktop.Notifications`) to swaync. Per-account notification grouping. |
| P1-3 | **Symmetria styling** | Custom frameless window with title bar matching Symmetria design language. Consistent color palette, fonts, and border radius. |
| P1-4 | **Selector registry** | JSON configuration file mapping logical UI elements to CSS selectors (`data-testid`, `aria-*`). Updatable without rebuilding. |
| P1-5 | **Zoom controls** | Per-account zoom level with persistence. |
| P1-6 | **Account management** | Add, remove, rename, and reorder accounts. |

#### P2 — Nice to Have

| ID | Requirement | Details |
|----|-------------|---------|
| P2-1 | **Custom CSS injection** | Per-account theme customization via user-provided CSS files. |
| P2-2 | **Download manager** | Intercept file downloads and manage them in a custom UI with configurable save path. |
| P2-3 | **Do Not Disturb** | Suppress notifications per-account or globally. |
| P2-4 | **Quick account switcher** | Keyboard shortcut (e.g., `Ctrl+1`/`Ctrl+2`) to jump between accounts. |
| P2-5 | **Start minimized** | CLI flag `--minimized` to start in system tray. |
| P2-6 | **Auto-launch** | Systemd user unit or XDG autostart entry. |

### Keyboard Navigation Specification

#### Modes

| Mode | Activation | Behavior |
|------|------------|----------|
| **Normal** | `Escape` from any mode | Navigate chats and messages without typing |
| **Insert** | `i` or `Enter` on chat | Focus message input, type naturally |
| **Command** | `:` in Normal mode | Execute commands (`:search`, `:archive`, `:mute`, etc.) |

#### Normal Mode Bindings

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous chat in list |
| `Enter` | Open selected chat and enter Insert mode |
| `Escape` | Return to chat list from conversation |
| `gg` / `G` | First / last chat |
| `/` | Focus search input |
| `Ctrl+D` / `Ctrl+U` | Scroll messages down / up (half page) |
| `r` | Reply to selected message |
| `e` | React to selected message |
| `y` | Copy message text |
| `gd` | Download attachment from selected message |
| `Ctrl+1..9` | Switch to account 1..9 |
| `Tab` | Cycle between accounts |

#### Insert Mode Bindings

| Key | Action |
|-----|--------|
| `Escape` | Return to Normal mode |
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+B/I/S` | Bold / italic / strikethrough formatting |

### Technical Architecture

```
symmetria-whatsapp/
├── CMakeLists.txt
├── src/
│   ├── main.cpp                 # App entry, WebEngine init
│   ├── qml/
│   │   ├── Main.qml             # Root window, account sidebar
│   │   ├── AccountView.qml      # WebEngineView per account
│   │   ├── AccountSidebar.qml   # Account list with badges
│   │   ├── TitleBar.qml         # Custom frameless title bar
│   │   └── components/          # Reusable QML components
│   └── js/
│       └── keyboard-nav.js      # Injected keyboard navigation layer
├── resources/
│   ├── selectors.json           # DOM selector registry
│   └── icons/                   # App and tray icons
├── docs/
│   └── PRD.md
└── CLAUDE.md
```

**Key dependencies:**
- `qt6-webengine` — Chromium-based web rendering
- `qt6-declarative` — QML engine
- `qt6-wayland` — Wayland platform plugin
- `qt6-svg` — SVG icon support

### Success Criteria (Phase 1)

1. Two WhatsApp accounts running simultaneously with independent sessions
2. Switch between accounts in under 500ms
3. Navigate chat list and open conversations entirely via keyboard
4. Notifications appear in swaync grouped by account
5. App uses less RAM than two separate browser tabs (~400MB total for 2 accounts)
6. Window matches Symmetria design language

---

## Phase 2 — Custom Frontend (Future)

### Vision

Replace the WhatsApp Web webview with a fully custom, keyboard-native UI that renders WhatsApp data directly.

### Approach Options

| Approach | Risk | Maintenance | Recommended |
|----------|------|-------------|-------------|
| Matrix bridge (`mautrix-whatsapp`) + custom Qt client | Moderate | Low | **Yes** |
| Baileys (direct protocol) + custom UI | High (bans) | High | No |
| whatsapp-web.js + custom overlay | Low-Moderate | Medium | Maybe |

### Phase 2 Requirements (Draft)

- Full message list rendered in native QML (not webview)
- Vim-like navigation across all UI elements
- Inline media preview and playback
- Message search with fuzzy matching
- Contact/group management via keyboard
- File browser for attachments
- Custom notification actions (reply from notification)
- Message threading and pinning
- Read/unread management

### Open Questions

- Is the Matrix bridge approach fast enough for real-time chat?
- Can we maintain E2E encryption through the bridge?
- What is the acceptable latency for message delivery?
- Should Phase 2 be a separate app or an evolution of Phase 1?

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
| WhatsApp DOM changes break keyboard nav | Medium | Selector registry pattern; community monitoring |
| WhatsApp blocks non-standard user agents | Low | Use standard Chromium UA (Qt WebEngine does this by default) |
| Account ban (Phase 2 only) | High | Use Matrix bridge; develop with secondary number |
| Qt WebEngine Wayland bugs | Low | Qt 6.8+ has resolved most issues; fallback flags available |
