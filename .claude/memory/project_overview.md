---
name: Symmetria WhatsApp Overview
description: Project goals, architecture decisions, and phased approach for building a Qt6-based WhatsApp wrapper with multi-account and keyboard-first navigation
type: project
---

Symmetria WhatsApp is a Qt6/QML-based WhatsApp desktop wrapper, part of the Symmetria ecosystem (shell, file manager, etc.).

**Why:** The user is dissatisfied with all existing WhatsApp desktop experiences. Needs multi-account support (work + personal numbers) and keyboard-first navigation. QuickShell was considered but ruled out — no WebEngine support, wrong tool for standalone apps.

**How to apply:**

**Phase 1 (MVP — WebView wrapper):**
- Standalone Qt6/QML app (NOT QuickShell)
- WebEngineView loading web.whatsapp.com
- Multi-account via QWebEngineProfile isolation (separate storageName per account)
- Custom frameless window matching Symmetria design language
- JavaScript injection for vim-like keyboard navigation (j/k, modal Normal/Insert/Command modes)
- Notifications via D-Bus (`org.freedesktop.Notifications`) to Symmetria Shell's notification center
- System tray via StatusNotifierItem
- Selector registry (JSON config) for maintainable DOM targeting using data-testid attributes
- Zero ToS ban risk (it's just a browser)

**Phase 2 (Custom frontend — future):**
- Matrix bridge (mautrix-whatsapp) + custom Qt/QML Matrix client preferred over Baileys (ban risk)
- Full keyboard-driven interface, complete message/media management without mouse

**Key references:**
- ZapZap (PyQt6, multi-account via QWebEngineProfile)
- WhatSie (C++ Qt6, most polished single-account wrapper, 3k+ stars)
- Altus (Electron/SolidJS, multi-account via partitions, JS injection patterns)
- nchat (C++ TUI, keyboard-first chat UX, native protocol)

**Arch packages needed:** qt6-webengine qt6-declarative qt6-webchannel qt6-positioning qt6-base qt6-svg qt6-wayland
