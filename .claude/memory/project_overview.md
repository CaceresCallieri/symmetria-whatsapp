---
name: symmetria-whatsapp-overview
description: "Project goals and the one durable constraint for the Electron multi-account WhatsApp wrapper with a rented Surfingkeys keyboard layer"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4aa3b17-be28-41ae-b890-35887e88614b
---

Symmetria WhatsApp is an Electron multi-account WhatsApp Web wrapper, part of the Symmetria ecosystem (shell, file manager). Its keyboard layer is the Surfingkeys extension, not code this project maintains.

**Why:** The user is dissatisfied with every existing WhatsApp desktop client. They need multi-account support (work and personal numbers) and keyboard-first navigation, on Arch Linux and Hyprland.

**How to apply:**

- `docs/PRD.md` is canonical for architecture, the workaround list and open questions. Read it there rather than trusting a summary in this note — the two have drifted before.
- The one architectural constraint worth holding before you act: **every account stays loaded**, because WhatsApp Web must stay connected to deliver notifications for an account the user is not looking at. That is why switching accounts only re-stacks views and is instant, and why "close the inactive ones to save memory" is wrong.
- Platform workarounds must not be removed. `docs/PRD.md` §"Workarounds that the platform forces" lists them with reasons and call sites.
- QuickShell was ruled out early — no WebEngine support, wrong tool for standalone apps.

Related: [[project_frontend_pivot]], [[feedback_auto_rebuild]].
