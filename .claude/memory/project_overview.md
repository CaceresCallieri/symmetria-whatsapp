---
name: symmetria-whatsapp-overview
description: "Project goals and architecture for the Electron multi-account WhatsApp wrapper with a rented Surfingkeys keyboard layer"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4aa3b17-be28-41ae-b890-35887e88464b
---

Symmetria WhatsApp is an Electron multi-account WhatsApp Web wrapper, part of the Symmetria ecosystem (shell, file manager). Its keyboard layer is the Surfingkeys extension, not code this project maintains.

**Why:** The user is dissatisfied with every existing WhatsApp desktop client. They need multi-account support (work and personal numbers) and keyboard-first navigation, on Arch Linux and Hyprland.

**How to apply:**

- Runtime is the Arch `electron` package. No build step for application code; `npm run build:extension` builds Surfingkeys into `vendor/`.
- One persistent session partition per account (`persist:account-<id>`) gives isolated cookies, storage and login. Every account stays loaded, because WhatsApp Web must stay connected to deliver notifications for accounts the user is not looking at.
- The window is frameless. Its renderer draws the title bar and account sidebar and loads nothing remote; each account's WhatsApp Web is a `WebContentsView` stacked into the same window.
- Notifications go through the main process so each carries its account name and a click focuses that account.
- Four platform workarounds exist and must not be removed. See `docs/PRD.md` for the table with reasons: plain-Chrome user agent, `chrome-extension:` added to the page CSP frame directives, forced `navigator.storage.persist`, and replaced `window.Notification`.
- QuickShell was ruled out early — no WebEngine support, wrong tool for standalone apps.

**The open risk:** Surfingkeys was proven to hint correctly on WhatsApp Web, but only against the logged-out page. Its behaviour inside a real conversation — the `contenteditable` composer stealing focus, the virtualised chat list — is unmeasured. Verifying it needs someone to scan a QR code.

**Key references:** ZapZap (PyQt6), WhatSie (C++ Qt6), Altus (Electron, multi-account via partitions), nchat (C++ TUI, keyboard-first).

Related: [[project_frontend_pivot]], [[feedback_auto_rebuild]].
