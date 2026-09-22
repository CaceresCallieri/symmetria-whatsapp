# Feature Ideas

A parking lot for feature ideas that have been researched but not yet implemented. Each file captures the problem, the research findings (so the investigation doesn't have to be redone later), a proposed architecture, risks, and open design decisions.

## How to use this folder

- **Before starting a feature** — check here first. If a doc exists, it's the starting point; update it as you implement rather than writing parallel notes.
- **When an idea comes up** — add a new file here. One feature per file. Open with a status line and a goal, then give the research and whatever blocks the idea; close with references. That order is a guide, not a template — an idea that is blocked needs its blockers stated plainly and needs no proposed architecture at all.
- **When a feature ships** — either move the doc into a `docs/shipped/` folder or delete it in the same commit that ships the feature. Stale ideas rot fast.

## Current ideas

| File | Status | One-liner |
|------|--------|-----------|
| [notification-voice-note-playback.md](./notification-voice-note-playback.md) | Researched — blocked twice over | Play a voice note from its notification without taking focus. Needs raw D-Bus for the action button (P2-1), and every known way to start playback reads WhatsApp's markup. |
