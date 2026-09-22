# Feature: Play Voice Notes from the Notification Without Stealing Focus

## Status: Researched — blocked twice over

This was researched against the Qt implementation. The Qt plumbing it proposed
is gone; what survives is the research, which is about the Web Notifications
API and the D-Bus notification spec rather than about either toolkit. It is
kept because the findings are real and rediscovering them costs a day.

**Read the two blockers before scoping this.** Both are structural, not
effort.

## Goal

A voice note arrives. The user wants to hear it from the notification, without
the app window taking focus from whatever they are doing. Today the only way is
to switch to the window, open the chat, and click play — which breaks
concentration every time.

## What the research established

**The audio never travels with the notification.** The Web Notifications API
WhatsApp Web uses has no audio field at all, in any browser. Whatever plays the
note has to be the page that already holds it. Extracting the blob instead
would mean reimplementing WhatsApp's authenticated media download, which is
session-tied, fragile, and squarely inside the "wrapper over protocol
reimplementation" prohibition.

**A notification daemon cannot host a player.** `org.freedesktop.Notifications`
carries a summary, a body, an `image-data` hint (already used for the sender
avatar) and a list of action buttons. It has no embedded audio, no progress bar
and no inline controls. So the notification can only ever *trigger* playback
somewhere else; it cannot be where playback happens.

**Deciding a notification is a voice note means reading its body text**, which
is locale-dependent — `"🎤 Voice message"`, `"🎤 Mensaje de voz"`, and so on.
The glyph is reasonably stable but not guaranteed. The cheaper design attaches
the action to every notification and lets it no-op when there is nothing to
play, rather than maintaining a locale table.

**Backgrounded pages may pause media.** Chromium fires `visibilitychange` and
sets `document.hidden` when the window loses focus, and WhatsApp Web may pause
playback when it believes it is backgrounded. A synthetic click counts as a
user gesture, so starting playback should work; pausing mid-playback is the
risk. Unmeasured — it may not bite at all when the window is merely unfocused
rather than hidden.

## Blocker 1: Electron exposes no notification actions on Linux

The `▶ Play` button this feature is built around does not exist to reach.
Electron's `Notification` registers only a `default` action on Linux, so adding
a second one means speaking `org.freedesktop.Notifications` directly over D-Bus
and giving up Electron's notification API. That is tracked as **P2-1** in
`docs/PRD.md` and is a prerequisite for this, not a detail of it.

## Blocker 2: the only known way to play the note is forbidden

Starting playback means finding WhatsApp's play button and clicking it. Every
route the research found does that by matching WhatsApp's markup —
`button[aria-label*="voice"]`, `[data-testid^="audio-play"]`, "the last play
button in the message list" — and sequencing it with opening the right chat
first, because WhatsApp virtualises offscreen conversations.

That is exactly the dependency on WhatsApp's DOM *structure* that this project
has paid for twice and now forbids outright. See `AGENTS.md` §"Key decisions".
A scoping attempt that begins "we only need one selector" has already failed
the test.

**What would unblock it:** a way to start playback that is a contract with the
browser rather than with WhatsApp's markup. Media Session API handlers are the
only candidate worth investigating — if WhatsApp registers `play` through
`navigator.mediaSession`, the app could invoke it without reading a single
selector. Nobody has checked whether it does. That check is the whole of the
next step, and it is cheap.

## References

- Notification signal path in this app: the "1. Route notifications through the
  main process" comment block in `src/preload/account.js` replaces
  `window.Notification`; `src/main/notifications.js` forwards it and routes the
  click back to the page.
- `docs/PRD.md` §"Requirements" P2-1 for the D-Bus prerequisite.
