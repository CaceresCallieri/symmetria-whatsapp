---
name: symmetria-whatsapp-overview
description: "Project goals, architecture decisions, and phased approach for building a Qt6-based WhatsApp wrapper with multi-account and keyboard-first navigation"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4aa3b17-be28-41ae-b890-35887e88614b
---

Symmetria WhatsApp is a Qt6/QML-based WhatsApp desktop wrapper, part of the Symmetria ecosystem (shell, file manager, etc.).

**Why:** The user is dissatisfied with all existing WhatsApp desktop experiences. Needs multi-account support (work + personal numbers) and keyboard-first navigation. QuickShell was considered but ruled out — no WebEngine support, wrong tool for standalone apps.

**How to apply:**

**Phase 1 (Stable wrapper — lives on `main`):**
- Standalone Qt6/QML app (NOT QuickShell)
- WebEngineView loading web.whatsapp.com
- Multi-account via QWebEngineProfile isolation (separate storageName per account)
- Custom frameless window matching Symmetria design language
- Notifications via D-Bus (`org.freedesktop.Notifications`) to Symmetria Shell's notification center
- System tray via StatusNotifierItem
- Zero ToS ban risk (it's just a browser)
- NOTE: JS-injection vim navigation + selector registry were REMOVED in the 2026-06-30 pivot — see [[project_frontend_pivot]]. Do not re-add DOM injection for navigation.

**Phase 2 (Native keyboard-driven Qt frontend — built on `dev`):**
- Native Qt/QML UI rendering WhatsApp data directly; WhatsApp is just a data/transport backend
- Backend architecture is UNDER EVALUATION (research-first): embedded webview (hybrid) / whatsapp-web.js / Matrix bridge / Baileys — no approach committed yet
- Full keyboard-driven interface, complete message/media management without mouse
- See [[project_frontend_pivot]] for the decision and rationale

**Key references:**
- ZapZap (PyQt6, multi-account via QWebEngineProfile)
- WhatSie (C++ Qt6, most polished single-account wrapper, 3k+ stars)
- Altus (Electron/SolidJS, multi-account via partitions, JS injection patterns)
- nchat (C++ TUI, keyboard-first chat UX, native protocol)

**Arch packages needed:** qt6-webengine qt6-declarative qt6-webchannel qt6-positioning qt6-base qt6-svg qt6-wayland
