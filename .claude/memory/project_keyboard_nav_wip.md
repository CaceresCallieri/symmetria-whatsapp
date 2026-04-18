---
name: Keyboard Nav WIP - Stashed
description: Context-aware vim keyboard navigation work stashed; WhatsApp changed DOM to ARIA roles, selectors need rework
type: project
originSessionId: f1cbd43e-ec25-4d6b-b7bb-72c5efb6704f
---
Keyboard navigation expansion is stashed in `git stash@{0}` (branch: main).

**What was built:** Context-aware NORMAL mode (CHAT_LIST vs CONVERSATION sub-contexts), Tab toggle via QML Shortcut bridge, three-layer input blocking (keydown/keypress/beforeinput), debug overlay, log file at /tmp/symmetria-debug.log.

**Why it's stalled:** WhatsApp Web has completely dropped `data-testid` attributes (only `selectable-text` remains). The DOM now uses ARIA roles: `role="grid"` (1x, chat list), `role="row"` (102x, chat items + messages), `role="gridcell"` (213x), `role="textbox"` (2x, search + message input). Selectors were updated to ARIA-based but not yet validated as working.

**Key findings:**
- Tab key cannot be captured in JS capture-phase inside WebEngineView — must be handled at QML Shortcut level, bridged to JS via `window.__symmetriaToggleContext`
- `keydown` preventDefault alone doesn't block typing in contentEditable — need `keypress` + `beforeinput` handlers too
- Qt's `console.log` in QML goes to stderr, not stdout — added C++ message handler writing to `/tmp/symmetria-debug.log`
- Chat list = `[role='grid']`, chat items = rows inside grid, messages = rows outside grid, conversation open = 2+ textboxes

**How to apply:** `git stash pop`, then verify ARIA selectors against live WhatsApp DOM using the debug overlay.
