---
name: project_frontend_pivot
description: "2026-06-30 strategic pivot — abandoned JS-injection keyboard nav, moving keyboard-first UX to a native Qt frontend; main=stable wrapper, dev=experimental frontend"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4aa3b17-be28-41ae-b890-35887e88614b
---

On 2026-06-30 the project pivoted away from delivering keyboard-first navigation by injecting JavaScript into WhatsApp Web's DOM. That JS-injection nav layer (`src/js/keyboard-nav.js`, `resources/selectors.json`, and its QML wiring) was **removed entirely**.

**Why:** The injection approach was an unwinnable maintenance treadmill. WhatsApp Web dropped the `data-testid` attributes the selector registry depended on (migrating to ARIA roles), and intercepting keys inside a foreign React app required brittle, stacked hacks — a QML `Shortcut` bridge just to capture `Tab`, plus `keydown`+`keypress`+`beforeinput` handlers to suppress typing in `contentEditable`. Every WhatsApp redesign silently broke it.

**How to apply:**
- **Do NOT re-add DOM injection for navigation.** If a future task asks for keyboard nav, the answer is the native frontend (Phase 2), not reviving injection. This supersedes the old stashed-nav memory (the stash no longer exists).
- **Branch model:** `main` = stable clean wrapper (PRD Phase 1, no injection/frontend); `dev` = experimental native Qt frontend (PRD Phase 2). Promote `dev` → `main` only when feature-complete.
- **Phase 2 = native keyboard-driven Qt frontend** that renders WhatsApp data directly, treating WhatsApp as a data/transport backend.
- **Backend architecture is UNDECIDED — research-first.** Candidates: embedded WhatsApp Web as a hidden engine (hybrid, zero ban risk, all-Qt) / whatsapp-web.js or WPPConnect (Node backend, low ban risk) / Matrix bridge `mautrix-whatsapp` (heavy infra) / Baileys (high ban risk). A research spike on ban-risk/latency/encryption/effort/maintenance must pick one before backend code is written. See `docs/PRD.md` Phase 2.

Related: [[project_overview]], [[feedback_auto_rebuild]].
