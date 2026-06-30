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
- **Backend architecture = HYBRID (decided 2026-06-30 via a fact-checked research spike).** Native Qt/QML UI on top of an embedded real WhatsApp Web instance in `QWebEngineView`, bridging data out / actions in over a minimal, targeted `QWebChannel` surface. Chosen for lowest ban risk (runs the genuine official client — Meta itself now ships its desktop app as a Chromium WebView of web.whatsapp.com) and clean E2E preservation; reuses the Phase 1 multi-account profile infra. Rejected: whatsapp-web.js (severe maintenance — scrapes internal webpack Store), Matrix bridge (fails E2E = end-to-bridge, heaviest infra), Baileys (highest/best-documented ban risk — Oct 2025 wave). The HYBRID read surface is NOT the abandoned nav injection — keep it minimal/targeted to stay change-resilient. Residual unknown: bridge stability vs. WhatsApp DOM changes (being validated by a thin spike on `dev`). See `docs/PRD.md` Phase 2 for cited evidence.

Related: [[project_overview]], [[feedback_auto_rebuild]].
