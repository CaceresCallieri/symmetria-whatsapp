# Feature: Play Voice Notes from the Notification Without Stealing Focus

## Status: Research Complete — Not Yet Scoped for Implementation

## Goal

When a WhatsApp voice note arrives, the user wants to play and listen to it **directly from the Symmetria Shell notification** — without the app window stealing focus from whatever they are currently working on. Today the only way to hear a voice note is to switch to the WhatsApp window, open the chat, and click the play button inside the conversation. This breaks concentration every time.

Desired UX:

1. Voice note arrives → notification appears in Symmetria Shell notification center.
2. Notification carries an inline `▶ Play` action button (in addition to the existing `Open`).
3. Clicking `▶ Play` starts playback of that voice note **in the background WebEngineView**.
4. The user's window focus stays exactly where it was. Audio routes through the normal PipeWire app stream.
5. (Optional stretch) A `⏸ Pause` / `⏹ Stop` action appears on the same notification while playback is active.

---

## Current State

The notification pipeline (`src/NotificationHandler.h`) forwards `QWebEngineNotification` events to the system notification daemon via the `org.freedesktop.Notifications` D-Bus interface. A single `"default"` action is registered:

```cpp
QStringList actions = {QStringLiteral("default"), QStringLiteral("Open")};
```

When the user clicks the notification, `onActionInvoked()` calls `raiseWindow()` + `notification->click()` + `notification->close()`. There is no concept of playing media inline, and every path currently raises the app window.

The notification payload contains only `title`, `message`, and `icon()` — **no audio data**. The voice note's audio blob lives inside the WhatsApp Web SPA and is only fetched when the user presses play on the chat's DOM play button.

---

## Research Findings

### 1. Audio Data Does Not Travel With the Notification

`QWebEngineNotification` exposes `title()`, `message()`, `icon()`, `tag()`, `origin()`, `language()`, `direction()` — nothing audio-related. The Web Notifications API WhatsApp Web uses has no audio field either. Any playback must happen **inside the existing WebEngineView** by driving the DOM, not by extracting the blob and handing it to `QMediaPlayer`. Extracting the blob would mean reimplementing WhatsApp's authenticated media download flow, which is fragile and session-tied.

### 2. Notification Daemons Cannot Embed Media Players

The `org.freedesktop.Notifications` spec supports:
- Text (summary + body)
- An icon (`image-data` hint, already used for contact photos)
- A list of action buttons (key + label pairs, clicked via `ActionInvoked` signal)

It does **not** support embedded audio players, progress bars, or inline controls. Symmetria Shell's notification center honors the spec — so the path forward is action-button-driven: the notification triggers playback in the app, it does not *host* playback itself.

### 3. Detecting That a Notification Is a Voice Note

WhatsApp Web fills `notification.body` with locale-dependent text:
- English: `"🎤 Voice message"` or similar glyph-prefixed string
- Spanish: `"🎤 Mensaje de voz"`
- Other locales: different strings

Two strategies:

- **Eager** — Always include the `▶ Play` action on every notification. If there's no voice note in that chat when clicked, the JS handler no-ops or falls back to just opening the chat.
- **Detective** — Regex-match `notification->message()` against a multi-locale pattern (🎤 is fairly stable across locales, but not guaranteed). Only attach the action when it matches.

The eager approach is simpler and degrades gracefully; the detective approach produces a cleaner UI at the cost of locale-maintenance burden.

### 4. WhatsApp Web DOM: Voice Note Play Button

Voice notes render inside message bubbles with a play button. Current known selectors (subject to WhatsApp's obfuscation):

- `button[aria-label="Play voice message"]` (English)
- `button[aria-label*="voice"]` (partial match — locale-dependent)
- `[data-testid^="audio-play"]` — historically existed, may be removed

The most-recent unread voice note would typically be the last `audio-play` button in the message list after opening the chat. The chat must be *focused* in the right panel for its DOM to be rendered (WhatsApp virtualizes offscreen chats).

### 5. Page Visibility API Interference

Qt WebEngine keeps background pages alive, but browsers (and by extension QtWebEngine) fire the Page Visibility API's `visibilitychange` event and set `document.hidden = true` when the window loses focus or is minimized. WhatsApp Web may pause media when it thinks it's backgrounded.

Two mitigations if this turns out to bite:

- Force `document.hidden = false` via `Object.defineProperty()` in an injected user script.
- Use `QWebEngineSettings::PlaybackRequiresUserGesture` — the synthetic click from our injected JS counts as a user gesture, so initial playback should work; it's only mid-playback pause-on-background that would be a problem.

This needs empirical testing — it may not be an issue at all if the window is simply unfocused rather than hidden.

### 6. Which Chat Gets Opened?

WhatsApp's notification carries the sender info but we cannot trivially pass "open this specific chat" to the WebEngineView without some form of identifier. Options:

- The notification `tag` WhatsApp uses may contain the chat JID (needs verification).
- Clicking the voice note play button inherently requires the chat to be open, so we probably have to: (a) click the most-recent unread chat entry in the sidebar, (b) wait for the chat panel to render, (c) click the voice note play button. This is a sequenced DOM automation.

This is more involved than the current "raise window + `notification->click()`" pattern, because Qt's `notification->click()` already does the right thing when the window is focused, but we want to skip the focus step.

---

## Proposed Architecture

### Data Flow

```
Voice note arrives
       |
       v  QWebEngineNotification (no audio payload)
NotificationHandler::onNotification()
       |
       v  D-Bus Notify with actions = {default, Open, play, ▶ Play}
Symmetria Shell notification center
       |
       v  User clicks ▶ Play → ActionInvoked(id, "play")
NotificationHandler::onActionInvoked("play")
       |
       v  NO raiseWindow() — just inject JS into the right profile's WebEngineView
JS: find sender's chat → click it → wait for render → find play button → click it
       |
       v  Audio streams through PipeWire, window focus is untouched
```

### Changes Required

#### 1. `NotificationHandler.h` — Register the new action

Add `"play"` + `"▶ Play"` to the `actions` list in `onNotification()`. Optionally, gate this on a voice-note detection regex against `notification->message()` (see "Detective" strategy above) to avoid showing Play on non-audio notifications.

#### 2. `NotificationHandler.h` — Handle the `"play"` action key

In `onActionInvoked()`, branch on `actionKey`:

```cpp
if (actionKey == "default") { /* existing: raise + click + close */ }
else if (actionKey == "play") {
    // Do NOT raiseWindow.
    // Do NOT close the notification (keep it visible so user can dismiss manually).
    // Resolve which WebEngineView owns this notification (per-account profile)
    //   and inject a JS snippet to drive DOM playback.
    emit playVoiceNoteRequested(it->accountName, /* some chat identifier if available */);
}
```

#### 3. New signal + QML wiring

`NotificationHandler` emits a new signal `playVoiceNoteRequested(accountName)`. `ProfileSetup` relays it. `Main.qml` routes it to the correct `AccountView` which calls `webView.runJavaScript(...)` with the playback snippet.

This mirrors the existing `notificationClicked` plumbing — same shape, different payload, different handler on the QML side.

#### 4. Injected JavaScript — Voice Note Playback

New file, e.g. `src/js/voice-note-playback.js`, injected on demand (not as a user script — one-shot via `runJavaScript()`). Responsibilities:

- Find the chat with the most recent unread voice note (selector: unread badge + voice-note indicator in chat list).
- Click it to focus the conversation.
- Wait for message panel to render (polling loop with timeout, same pattern as `keyboard-nav.js` init).
- Find the latest voice note's play button (last `button[aria-label*="voice" i]` or equivalent in the message list).
- Click it. Done.
- Optionally: scroll it into view first (some voice notes may be offscreen).
- If at any step nothing is found, fail silently — user can always click the notification normally.

#### 5. (Stretch) Pause/Stop While Playing

After kicking off playback, optionally: modify the notification in-place (D-Bus supports replacing a notification by re-sending `Notify` with `replaces_id`) to swap `▶ Play` for `⏸ Pause` / `⏹ Stop`. Handler would inject JS to click the same button again (WhatsApp's play button toggles). Requires tracking per-notification playback state in `NotificationHandler`.

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp changes the voice-note DOM selector | Play action silently no-ops | Move selectors to `resources/selectors.json`, update centrally |
| Page Visibility API pauses backgrounded media | Playback starts then stops | Inject `document.hidden = false` override; test first to see if needed |
| Locale-dependent voice-note detection misfires | Play button appears on text messages, does nothing when clicked | Eager strategy — always show, fail silently |
| Injected JS runs before chat panel renders | Play button not found, playback fails | Polling loop with reasonable timeout (500ms–2s) |
| Multiple voice notes in same chat → which one plays? | User hears wrong message | Most-recent-unread heuristic; if ambiguous, fall back to opening the chat |
| `notification->click()` is skipped on Play action | WhatsApp's unread state for that chat not cleared | Consider calling `notification->click()` anyway after injecting play JS (it's idempotent — won't re-raise window because we never called `raiseWindow()`) |
| Per-account targeting: we need to know which profile's WebEngineView to drive | Wrong account tries to play | `NotificationHandler::m_active[dbusId]` already tracks `accountName` — reuse it to route |

---

## Open Design Decisions

1. **Eager vs. Detective detection**: Always show `▶ Play`, or only when body matches a voice-note pattern? Eager is simpler and more forgiving of locale changes.
2. **JS injection strategy**: One-shot via `runJavaScript()`, or a persistent helper installed at page-load time alongside `keyboard-nav.js` that exposes a `window.__symmetriaPlayLatestVoiceNote()` function we can invoke?
3. **Auto-close notification after playback finishes?** Would need a callback from the WebEngineView when audio ends — doable via a MutationObserver on the play button's pressed state, but adds complexity.
4. **Play-Pause-Stop state machine**: Scope for v2? v1 could be fire-and-forget.
5. **Chat-focus side-effects**: Clicking the chat in the sidebar to load its DOM changes which chat is currently "open" inside WhatsApp, even though our window isn't focused. Is that acceptable, or do we need to restore the previously-open chat after playback starts?
6. **Keyboard shortcut parity**: Should Symmetria Shell's notification keybindings surface this action (e.g., `Super+Shift+P` on a focused notification = play)? Out of scope for this app but worth flagging to the shell.

---

## References

- Current notification pipeline: `src/NotificationHandler.h` (especially `onActionInvoked` at line 243 and the `actions` list at line 118).
- Notification signal chain: `NotificationHandler::notificationClicked` → `ProfileSetup::notificationClicked` → `Main.qml` `Connections { target: ProfileSetup }`.
- Selector registry (for future voice-note selector entries): `resources/selectors.json`.
- Freedesktop Notifications spec: https://specifications.freedesktop.org/notification-spec/latest/
- `QWebEngineNotification` API surface: Qt docs confirm no audio payload access.
- Related file: `docs/feature-ideas/profile-picture-avatars.md` (similar injected-JS-into-WebEngineView pattern).
