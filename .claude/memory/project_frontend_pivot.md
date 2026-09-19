---
name: project_frontend_pivot
description: "Two pivots on how to deliver keyboard navigation; the current answer is Electron plus the Surfingkeys extension, and the reason is that Qt WebEngine has no extension API"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4aa3b17-be28-41ae-b890-35887e88614b
---

The project has pivoted twice on the same question: how to get vim-style keyboard navigation without an unmaintainable amount of work.

**Pivot 1 (2026-06-30) — away from JS injection.** Keyboard navigation was delivered by injecting JavaScript into WhatsApp Web's DOM. Abandoned: WhatsApp dropped the `data-testid` attributes the selector registry depended on, and intercepting keys inside a foreign React app needed stacked hacks. The plan became a native Qt frontend treating WhatsApp as a data backend.

**Pivot 2 (2026-09-19) — away from a native frontend, to Electron plus Surfingkeys.** A native frontend required choosing a backend to source WhatsApp data from, and every candidate carried ban risk, heavy infrastructure, or a large dependency. That decision had blocked the project outright. The current direction avoids the question: stay a WhatsApp Web wrapper, and **rent the keyboard layer from the Surfingkeys extension** instead of building it.

**Why Electron specifically:** Qt WebEngine exposes no extension API at all — only user scripts, which is the raw-injection route pivot 1 abandoned. That single fact drove the re-platform. Nothing else about the two stacks mattered enough.

**How to apply:**
- **Never re-add DOM injection for navigation.** This project has paid for that twice. Patching browser APIs (`window.Notification`, `navigator.storage`) is a different thing and is fine — those are contracts with the browser, not with WhatsApp.
- **Never reimplement the WhatsApp protocol.** whatsapp-web.js, Matrix bridges and Baileys were all evaluated and all rejected. The wrapper approach is what makes the ban risk zero and it has survived every pivot.
- **Rent, do not build, the keyboard layer.** Two attempts to own it failed or stalled.
- **Branch model:** `main` holds the old Qt implementation as a working fallback. The Electron app lives on its own branch until it has been a daily driver.
- Upgrading Electron, Surfingkeys or `electron-chrome-extensions` breaks the keyboard layer *silently*. Always run `scripts/verify-keyboard-layer.js` afterwards.

Related: [[project_overview]], [[feedback_auto_rebuild]].
