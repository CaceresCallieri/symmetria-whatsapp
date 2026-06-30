# Symmetria WhatsApp

Qt6/QML multi-account WhatsApp wrapper, pivoting toward a native keyboard-driven frontend. Part of the Symmetria ecosystem. See `docs/PRD.md` for the full vision and the pivot rationale.

## Branch model

- **`main` = stable.** Clean multi-account WhatsApp Web wrapper (PRD Phase 1). The old JS-injection keyboard-nav layer has been removed; this branch is always usable.
- **`dev` = experimental.** Where the native keyboard-driven Qt frontend (PRD Phase 2) is built. Promoted to `main` only when feature-complete enough to be the daily driver.

## Stack

- **Language:** C++ (main) + QML (UI)
- **Framework:** Qt6 with WebEngineView
- **Build:** CMake
- **Target:** Arch Linux / Wayland (Hyprland)

## Architecture

- Each account = separate `QWebEngineProfile` (isolated cookies/storage)
- Notifications forwarded via D-Bus (`org.freedesktop.Notifications`) to Symmetria Shell's notification center

## Workflow

- **Auto-rebuild after changes:** After modifying any source file (C++, QML, JSON resources), always run `cmake --build build` automatically so the user only needs to relaunch `./build/symmetria-whatsapp`.

## Key Decisions

- **Qt6/QML over QuickShell:** QuickShell lacks WebEngine support and is designed for shell components, not standalone apps
- **WebView wrapper over protocol reimplementation:** Zero ban risk, proven approach
- **JS-injection keyboard nav was abandoned (do not re-add it):** Driving vim-like navigation by injecting JS into WhatsApp Web's DOM proved unmaintainable — WhatsApp dropped `data-testid` for ARIA roles, and intercepting keys in a foreign React app required brittle multi-layer hacks. The keyboard-first goal moved to a native Qt frontend (Phase 2). If you're tempted to re-introduce DOM injection for navigation, that's the wrong direction — see PRD Phase 2.
- **Phase 2 backend = HYBRID (decided 2026-06-30 via research spike):** The native frontend renders on top of an embedded real WhatsApp Web instance in `QWebEngineView`, reading data out / sending actions in over a **minimal, targeted `QWebChannel` bridge**. Chosen for lowest ban risk (it runs the genuine official client — the same architecture Meta now ships) and clean E2E preservation; it reuses the Phase 1 multi-account profile infra. Rejected: whatsapp-web.js (severe maintenance), Matrix bridge (fails E2E, heaviest infra), Baileys (highest ban risk). Full rationale + cited evidence in `docs/PRD.md` Phase 2. NOTE: the targeted-JS read surface here is NOT the abandoned nav injection — it reads data into our own native UI rather than faking navigation in WhatsApp's UI. Keep that surface minimal to stay change-resilient.
