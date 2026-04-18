---
name: Auto-rebuild after code changes
description: Always run cmake --build after modifying source files so user only has to relaunch the binary
type: feedback
originSessionId: 83d1884e-bab4-49c0-a88a-78d68460eefb
---
After making changes to any source file (C++, QML, JS, JSON resources), always run `cmake --build build` automatically.

**Why:** The user doesn't want to manually rebuild — they just want to run `./build/symmetria-whatsapp` and see the changes.

**How to apply:** Every time you edit a source file, run the build command before telling the user to relaunch. Don't ask, just do it.
