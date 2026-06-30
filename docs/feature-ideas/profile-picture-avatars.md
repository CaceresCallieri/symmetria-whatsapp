# Feature: Profile Picture Avatars in Account Sidebar

## Status: Research Complete — Ready for Implementation

## Goal

Replace the current letter-based account indicators (P for Personal, W for Work) in `AccountSidebar.qml` with the actual WhatsApp profile pictures of each linked account. Future enhancement: add a "+" button to create new accounts.

## Current State

The sidebar renders 36x36 circular pills with monospace letter initials, driven by the `accounts` array in `Main.qml`:

```qml
property var accounts: [
    { name: "Personal", initial: "P", unreadCount: 0 },
    { name: "Work",     initial: "W", unreadCount: 0 }
]
```

No image support exists yet in the sidebar.

---

## Research Findings

### ZapZap (Open Source Qt WhatsApp Wrapper)

ZapZap does **not** extract real profile pictures from WhatsApp Web. Instead:

- Each account gets a **randomly-colored SVG icon** generated at creation time (`UserIcon.get_new_icon_svg()`)
- The SVG is stored as a TEXT field in SQLite
- Users can regenerate colors but never use their actual WhatsApp avatar
- For **notifications**, ZapZap uses `QWebEngineNotification.icon()` — but this gives the **sender's** photo (from the notification payload), not the current user's own profile picture

### WhatsApp Web DOM: Profile Picture Locations

The user's own profile picture appears in:

- **Left sidebar header**: Small circular avatar in the top-left corner
- **Profile settings panel**: Larger version when clicking avatar or going to Settings > Profile

**No stable `data-testid` attribute** exists for the user's own profile picture. The tithiwa project's selector list (comprehensive `data-testid` coverage) does not include any profile picture selector. WhatsApp's `data-testid` attributes cover interactive UI elements but profile images lack them.

### Three Extraction Approaches

#### Approach A: WhatsApp Internal Module API (Most Robust)

WhatsApp Web exposes internal JS modules via `window.require()`:

```javascript
// Get current user's WhatsApp ID
const meWid = window.require('WAWebUserPrefsMeUser').getMaybeMePnUser();

// Get profile pic URL via ProfilePicThumb collection
const thumb = await window.require('WAWebCollections').ProfilePicThumb.find(meWid);
const imageUrl = thumb.img; // fetchable CDN URL

// Alternative: request directly from server
const result = await window.require('WAWebContactProfilePicThumbBridge')
    .requestProfilePicFromServer(chat);
const imageUrl = result.eurl;
```

**Pros**: Most reliable data source, same approach used by `whatsapp-web.js` library
**Cons**: Module names change across WhatsApp versions (webpack bundle refactors)

#### Approach B: DOM Image Extraction (Simplest)

```javascript
const headerImg = document.querySelector('#side header img');
if (headerImg && headerImg.src) {
    // src may be a blob: URL — needs fetch + base64 conversion
}
```

**Pros**: Simple, few lines of code
**Cons**: Selector breaks on any WhatsApp UI update; `blob:` URLs need special handling

#### Approach C: Synthetic Icons (ZapZap Style)

Generate colored SVG icons per account, never extract real photos.

**Pros**: Never breaks, zero dependency on WhatsApp DOM
**Cons**: Not the real profile picture

### Recommended Strategy: Cascading Fallback

1. **Try** internal module API (`WAWebCollections.ProfilePicThumb.find(meWid)`)
2. **Fall back** to DOM scraping (`#side header img`)
3. **Fall back** to letter initial (current behavior — always works)
4. **Cache** extracted image to disk for instant loading on next launch

---

## Proposed Architecture

### Data Flow

```
WhatsApp Web DOM (per account)
        |
        v  JS extraction (new avatar-extract logic)
   base64 data URI
        |
        v  runJavaScript() callback
   AccountView.qml
        |
        v  signal: avatarReady(base64)
   Main.qml (updates accounts[i].avatarSource)
        |
        v  property binding
   AccountSidebar.qml (shows Image or Text fallback)
        |
        v  (optional) C++ helper saves to disk
   ~/.local/share/symmetria-whatsapp/<profile>/avatar.png
```

### Changes Required

#### 1. JavaScript — Profile Picture Extraction

New extraction logic, triggered after WhatsApp chat list initializes (same timing as keyboard-nav init). Options:
- Add to `keyboard-nav.js` (convenient, same injection point)
- New `avatar-extract.js` file (cleaner separation)

Must handle:
- `blob:` URL conversion via `fetch()` + `FileReader` → base64
- CDN URL conversion via `fetch()` → base64
- Null/empty results (user has no profile picture)

#### 2. QML — AccountSidebar.qml

Add dual-mode rendering per account pill:
- If `avatarSource` is set → circular `Image` element (36x36, layer.enabled + OpacityMask or clip)
- If not → current `Text` element with letter initial

Account model gains new property:
```qml
{ name: "Personal", initial: "P", avatarSource: "", unreadCount: 0 }
```

#### 3. QML — AccountView.qml

Add signal plumbing:
- New signal: `avatarExtracted(string base64DataUri)`
- Trigger extraction after `onLoadingChanged` (after keyboard-nav injection)
- Use `runJavaScript()` with callback to receive the base64 result

#### 4. C++ — Disk Caching (Optional Enhancement)

Cache extracted avatars to profile storage directory:
- Path: `~/.local/share/symmetria-whatsapp/<profile>/avatar.png`
- Load cached avatar on startup (instant display before WhatsApp loads)
- Re-extract periodically or when cache is stale

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp changes internal module names | Extraction fails silently | Cascading fallback chain |
| DOM selector `#side header img` breaks | Second fallback fails | Letter initial always works |
| `blob:` URLs need special handling | Can't use `src` directly | `fetch()` + `FileReader` → base64 |
| Profile pic CDN URL expires | Cached URL stops working | Cache image data, not the URL |
| User has no profile picture set | Null/empty result | Fall back to letter initial |

---

## Open Design Decisions

1. **Extraction timing**: During existing init polling (when chat list appears) or separate delayed poll?
2. **JS file organization**: Inline in `keyboard-nav.js` or separate `avatar-extract.js`?
3. **Cache refresh strategy**: Every launch? Only if cached avatar older than N days?
4. **"+" button**: Scope for a separate feature — requires dynamic account creation (currently hardcoded in 3 places)

## References

- ZapZap source: `zapzap/resources/UserIcon.py`, `zapzap/models/User.py`
- whatsapp-web.js: Uses `WAWebCollections.ProfilePicThumb` and `WAWebUserPrefsMeUser` modules
- tithiwa project: Comprehensive `data-testid` selector list (no profile picture selectors found)
- Current sidebar: `src/qml/AccountSidebar.qml` (36x36 pills, letter initials)
- Current account model: `src/qml/Main.qml` lines 22-25
