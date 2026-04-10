# Symmetria WhatsApp

Qt6/QML WhatsApp wrapper with multi-account support and vim-like keyboard navigation. Part of the Symmetria ecosystem.

## Stack

- **Language:** C++ (main) + QML (UI) + JavaScript (injected keyboard nav)
- **Framework:** Qt6 with WebEngineView
- **Build:** CMake
- **Target:** Arch Linux / Wayland (Hyprland)

## Architecture

- Each account = separate `QWebEngineProfile` (isolated cookies/storage)
- Keyboard navigation via JS injection into WhatsApp Web DOM
- Selector registry (`resources/selectors.json`) maps logical elements to CSS selectors
- Notifications forwarded via D-Bus to swaync

## Workflow

- **Auto-rebuild after changes:** After modifying any source file (C++, QML, JS, JSON resources), always run `cmake --build build` automatically so the user only needs to relaunch `./build/symmetria-whatsapp`.

## Key Decisions

- **Qt6/QML over QuickShell:** QuickShell lacks WebEngine support and is designed for shell components, not standalone apps
- **WebView wrapper over protocol reimplementation:** Zero ban risk, proven approach
- **`data-testid` selectors over class names:** WhatsApp obfuscates CSS classes but `data-testid` attributes are relatively stable
