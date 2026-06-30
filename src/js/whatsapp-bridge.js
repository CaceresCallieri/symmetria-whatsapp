// HYBRID bridge — page side (PRD Phase 2 spike).
//
// Runs inside the embedded WhatsApp Web page. Connects to the native side over
// QWebChannel (the `WhatsAppBridge` C++ object, published as `bridge`), scrapes
// a MINIMAL slice of state — the chat list (title + unread count) — and pushes
// it to native QML. Re-scrapes on DOM mutation, debounced.
//
// Design rule (see CLAUDE.md): keep the read surface SMALL and targeted. This is
// data extraction into our own UI, not navigation injection into WhatsApp's UI.
//
// Requires qwebchannel.js to have been injected first, and the WebEngineView's
// webChannel to be set (which installs `qt.webChannelTransport`).
(function () {
    "use strict";

    if (window.__symmetriaBridgeInit) return;
    window.__symmetriaBridgeInit = true;

    var bridge = null;

    // Find chat-list rows resiliently. WhatsApp Web migrated the chat list from
    // [role="listitem"] to an ARIA grid ([role="grid"] > [role="row"]); try the
    // known variants in order and use whichever the current DOM exposes. This is
    // the change-resilience strategy: a tiny ranked selector list, not a brittle
    // single selector.
    var ROW_SELECTORS = [
        '#pane-side [role="listitem"]',
        '#pane-side [role="row"]',
        '#pane-side [role="gridcell"]'
    ];

    function findRows() {
        for (var i = 0; i < ROW_SELECTORS.length; i++) {
            var rows = document.querySelectorAll(ROW_SELECTORS[i]);
            if (rows.length) return rows;
        }
        return [];
    }

    // Read the chat list (title + unread). span[title] holds the full chat name.
    function readChats() {
        var rows = findRows();
        var chats = [];
        rows.forEach(function (row) {
            var nameEl = row.querySelector("span[title]");
            if (!nameEl) return;
            var title = nameEl.getAttribute("title") || nameEl.textContent || "";

            var unread = 0;
            var unreadEl = row.querySelector('span[aria-label*="unread" i]');
            if (unreadEl) {
                var m = (unreadEl.getAttribute("aria-label") || "").match(/\d+/);
                if (m) unread = parseInt(m[0], 10);
            }

            if (title) chats.push({ title: title, unread: unread });
        });
        return chats;
    }

    // Action-IN (native UI → page): write `text` into WhatsApp Web's compose
    // box, and send if `autoSend`. execCommand("insertText") is the reliable way
    // to feed a React-controlled contenteditable — direct textContent edits are
    // dropped by React. Requires a chat to be open (the footer/compose exists).
    function doSend(text, autoSend) {
        var box = document.querySelector('footer [contenteditable="true"]');
        if (!box) {
            console.error("[Symmetria] send: no compose box — is a chat open?");
            return;
        }
        box.focus();
        var ok = document.execCommand("insertText", false, text);
        console.log("[Symmetria] send: inserted (autoSend=" + autoSend + ", ok=" + ok + ")");
        if (!autoSend) return;

        // Prefer the explicit send button; fall back to an Enter keypress.
        var icon = document.querySelector('footer [aria-label="Send"], footer span[data-icon="send"]');
        if (icon) {
            (icon.closest("button") || icon).click();
        } else {
            box.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
            }));
        }
        console.log("[Symmetria] send: dispatched send");
    }

    function push() {
        if (!bridge) return;
        try {
            bridge.receiveChats(JSON.stringify(readChats()));
        } catch (e) {
            console.error("[Symmetria] bridge push failed:", e);
        }
    }

    // Debounce so a burst of DOM mutations collapses into one bridge call.
    var debounceTimer = null;
    function pushDebounced() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(push, 300);
    }

    if (typeof QWebChannel === "undefined" || !window.qt || !qt.webChannelTransport) {
        console.error("[Symmetria] bridge: QWebChannel transport unavailable");
        return;
    }

    new QWebChannel(qt.webChannelTransport, function (channel) {
        bridge = channel.objects.bridge;
        if (!bridge) {
            console.error("[Symmetria] bridge: 'bridge' object not found on channel");
            return;
        }
        console.log("[Symmetria] QWebChannel connected — bridge ready");

        // Action-in: native UI send requests → WhatsApp Web compose box.
        bridge.sendRequested.connect(doSend);
        console.log("[Symmetria] bridge: send handler registered");

        // Attach the mutation observer once the chat pane exists (it may not at
        // connect time — still loading, or logged out on the QR screen).
        var observerAttached = false;
        function tryAttachObserver() {
            if (observerAttached) return;
            var pane = document.querySelector("#pane-side");
            if (!pane) return;
            new MutationObserver(pushDebounced).observe(pane, {
                childList: true,
                subtree: true,
                characterData: true
            });
            observerAttached = true;
            console.log("[Symmetria] bridge: observer attached to #pane-side");
        }

        tryAttachObserver();
        push();

        // Poll a handful of times so the pane/observer/data catch up after the
        // page finishes loading or after the user logs in (then the observer
        // takes over for live updates). Spike limitation: stops after ~30s, so a
        // very-late login on a second account won't be picked up.
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            tryAttachObserver();
            push();
            if (tries >= 15) clearInterval(iv);
        }, 2000);
    });
})();
