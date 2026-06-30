# Feature Ideas

A parking lot for feature ideas that have been researched but not yet implemented. Each file captures the problem, the research findings (so the investigation doesn't have to be redone later), a proposed architecture, risks, and open design decisions.

## How to use this folder

- **Before starting a feature** — check here first. If a doc exists, it's the starting point; update it as you implement rather than writing parallel notes.
- **When an idea comes up** — add a new file here. One feature per file. Follow the structure of existing entries (Status → Goal → Current State → Research → Proposed Architecture → Risks → Open Decisions → References).
- **When a feature ships** — either move the doc into a `docs/shipped/` folder or delete it in the same commit that ships the feature. Stale ideas rot fast.

## Current ideas

| File | Status | One-liner |
|------|--------|-----------|
| [profile-picture-avatars.md](./profile-picture-avatars.md) | Research Complete — Ready for Implementation | Show real WhatsApp profile pictures in the account sidebar instead of letter initials. |
| [notification-voice-note-playback.md](./notification-voice-note-playback.md) | Research Complete — Not Yet Scoped | Play voice-note notifications directly from the Symmetria Shell notification center without stealing window focus. |
