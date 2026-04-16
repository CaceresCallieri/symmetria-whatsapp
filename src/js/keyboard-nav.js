(function() {
    "use strict";

    const DEBUG = true;

    const MODE = { NORMAL: "NORMAL", INSERT: "INSERT" };
    const CONTEXT = { CHAT_LIST: "CHAT_LIST", CONVERSATION: "CONVERSATION" };
    let currentMode = MODE.INSERT; // Start in INSERT so WhatsApp loads normally (enterNormalMode called from init timer)
    let currentContext = CONTEXT.CHAT_LIST;

    // WhatsApp Web uses ARIA roles instead of data-testid attributes.
    // The chat list is the single role="grid" element; individual chats and
    // messages are role="row" elements scoped to their containers.
    // If selectors change, update BOTH this file and resources/selectors.json.
    const SELECTORS = {
        chatList: "[role='grid']",
        chatItem: "[role='row']",
        // messageRow intentionally uses the same selector as chatItem; differentiated
        // by DOM position (getMessageItems filters out rows inside the chat grid).
        messageRow: "[role='row']",
        textbox: "[role='textbox']",
    };

    // Message highlight uses inset box-shadow to layer a green tint on top of
    // WhatsApp's native backgrounds without overriding them. The 1000px spread
    // creates a full-area overlay; the 3px left shadow adds an accent bar.
    const HIGHLIGHT_STYLE = {
        message: "inset 3px 0 0 #5af78e, inset 0 0 0 1000px rgba(90, 247, 142, 0.10)",
    };

    let selectedChatIndex = -1;
    let selectedMessageIndex = -1;
    let _pendingGg = false;     // true while waiting for second 'g' to complete gg chord
    let _pendingGgTimer = null; // timeout that cancels the pending chord

    // --- Mode Indicator Overlay ---
    const indicator = document.createElement("div");
    indicator.id = "symmetria-mode-indicator";
    Object.assign(indicator.style, {
        position: "fixed",
        bottom: "8px",
        left: "8px",
        padding: "4px 12px",
        borderRadius: "4px",
        fontSize: "11px",
        fontFamily: "monospace",
        fontWeight: "bold",
        zIndex: "999999",
        pointerEvents: "none",
        transition: "opacity 0.15s, background-color 0.15s",
        opacity: "0",
    });
    document.body.appendChild(indicator);

    // --- Debug Overlay (temporary — shows selector diagnostics) ---
    let debugOverlay = null;
    if (DEBUG) {
        debugOverlay = document.createElement("div");
        debugOverlay.id = "symmetria-debug";
        Object.assign(debugOverlay.style, {
            position: "fixed",
            top: "8px",
            right: "8px",
            padding: "8px 12px",
            borderRadius: "4px",
            fontSize: "10px",
            fontFamily: "monospace",
            lineHeight: "1.5",
            backgroundColor: "rgba(0,0,0,0.85)",
            color: "#ccc",
            zIndex: "999999",
            pointerEvents: "auto",
            maxWidth: "400px",
            maxHeight: "80vh",
            overflow: "auto",
            whiteSpace: "pre-wrap",
        });
        document.body.appendChild(debugOverlay);
    }

    let _lastDebugInfo = "";
    function updateDebugOverlay(extra) {
        if (!debugOverlay) return;
        const grid = document.querySelector(SELECTORS.chatList);
        const gridRows = grid ? grid.querySelectorAll(SELECTORS.chatItem).length : 0;
        const allRows = document.querySelectorAll(SELECTORS.messageRow).length;
        const nonGridRows = allRows - gridRows;
        const textboxes = document.querySelectorAll(SELECTORS.textbox).length;
        const convOpen = isConversationOpen();

        const info =
            "Mode: " + currentMode + " | Ctx: " + currentContext + "\n" +
            "grid: " + (grid ? "YES" : "NO") + " | gridRows: " + gridRows + "\n" +
            "totalRows: " + allRows + " | msgRows: " + nonGridRows + "\n" +
            "textboxes: " + textboxes + " | convOpen: " + convOpen + "\n" +
            "selChatIdx: " + selectedChatIndex + " | selMsgIdx: " + selectedMessageIndex +
            (extra ? "\nLast: " + extra : "");

        debugOverlay.textContent = info;

        // Only log to console when state has changed — avoids flooding
        // /tmp/symmetria-debug.log on every keypress and auto-scan tick.
        if (info !== _lastDebugInfo) {
            _lastDebugInfo = info;
            console.log("[Symmetria] " + info.replace(/\n/g, " | "));
        }
    }

    function updateIndicator() {
        if (currentMode === MODE.NORMAL) {
            if (currentContext === CONTEXT.CONVERSATION) {
                indicator.textContent = "NORMAL \u00b7 MSG";
            } else {
                indicator.textContent = "NORMAL";
            }
            indicator.style.backgroundColor = "#5af78e";
            indicator.style.color = "#1a1a2e";
            indicator.style.opacity = "0.9";
        } else {
            indicator.textContent = "INSERT";
            indicator.style.backgroundColor = "#57c7ff";
            indicator.style.color = "#1a1a2e";
            indicator.style.opacity = "0.7";
        }
        updateDebugOverlay();
    }

    // --- Chat Navigation ---
    function getChatItems() {
        const grid = document.querySelector(SELECTORS.chatList);
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(SELECTORS.chatItem));
    }

    // Chat highlight uses border-left (not box-shadow) — inset box-shadow
    // bleeds through the gaps between adjacent rows in WhatsApp's chat list.
    function highlightChat(index) {
        const chats = getChatItems();
        chats.forEach(chat => {
            chat.style.borderLeft = "";
        });

        if (index >= 0 && index < chats.length) {
            selectedChatIndex = index;
            const target = chats[index];
            target.style.borderLeft = "3px solid #5af78e";
            target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        updateDebugOverlay();
    }

    // Dispatch a full mouse event sequence that React's event delegation
    // system will pick up. A bare .click() often doesn't trigger React
    // handlers because they rely on mousedown/mouseup bubbling to the root.
    function simulateClick(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
        element.dispatchEvent(new MouseEvent("click", opts));
    }

    function openSelectedChat() {
        const chats = getChatItems();
        if (selectedChatIndex >= 0 && selectedChatIndex < chats.length) {
            const row = chats[selectedChatIndex];
            const rect = row.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            // Use elementFromPoint to find the exact DOM element at the
            // center of the row — this matches real user click hit-testing.
            // WhatsApp's React handlers check the event target; clicking a
            // parent container (row/gridcell) doesn't trigger chat opening.
            const target = document.elementFromPoint(x, y);

            if (DEBUG) console.log("[Symmetria] Opening chat at index", selectedChatIndex,
                "hit:", target ? target.tagName + "." + (target.className || "").slice(0, 30) : "null");

            if (target) {
                simulateClick(target);
            }
        }
    }

    // --- Message Navigation ---
    function getMessageItems() {
        // Messages are role="row" elements NOT inside the chat list grid.
        const grid = document.querySelector(SELECTORS.chatList);
        const allRows = Array.from(document.querySelectorAll(SELECTORS.messageRow));
        return allRows.filter(row => !grid || !grid.contains(row));
    }

    function highlightMessage(index) {
        const messages = getMessageItems();
        messages.forEach(msg => {
            msg.style.boxShadow = "";
        });

        if (index >= 0 && index < messages.length) {
            selectedMessageIndex = index;
            const target = messages[index];
            target.style.boxShadow = HIGHLIGHT_STYLE.message;
            target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        updateDebugOverlay();
    }

    function clearMessageHighlight() {
        const messages = getMessageItems();
        messages.forEach(msg => {
            msg.style.boxShadow = "";
        });
        selectedMessageIndex = -1;
    }

    function isConversationOpen() {
        // When a conversation is open, there are 2+ textboxes (search + message input).
        // When no chat is open, there's only 1 (search).
        return document.querySelectorAll(SELECTORS.textbox).length >= 2;
    }

    function scrollConversation(direction) {
        // Find the scrollable message area. We look for the container that holds
        // the non-grid rows (messages). Walk up from the first message row.
        const messages = getMessageItems();
        if (messages.length === 0) return;

        // Find the nearest scrollable ancestor of the first message
        let scrollable = messages[0].parentElement;
        while (scrollable && scrollable.scrollHeight <= scrollable.clientHeight) {
            scrollable = scrollable.parentElement;
        }
        if (!scrollable) return;

        const halfPage = scrollable.clientHeight / 2;
        const delta = direction === "down" ? halfPage : -halfPage;

        scrollable.scrollBy({ top: delta, behavior: "smooth" });

        // Re-index after WhatsApp's virtual list renders new messages
        setTimeout(() => {
            const messages = getMessageItems();
            if (messages.length === 0) return;
            // Guard: if WhatsApp's virtual list removed the scrollable container
            // during the scroll, skip re-indexing to avoid a zero-rect false result.
            if (!document.contains(scrollable)) return;

            const panelRect = scrollable.getBoundingClientRect();
            const centerY = panelRect.top + panelRect.height / 2;
            let closestIndex = 0;
            let closestDistance = Infinity;

            messages.forEach((msg, i) => {
                const rect = msg.getBoundingClientRect();
                const msgCenterY = rect.top + rect.height / 2;
                const distance = Math.abs(msgCenterY - centerY);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = i;
                }
            });

            highlightMessage(closestIndex);
        }, 200);
    }

    // --- Input Helpers ---
    function focusMessageInput() {
        // The message input is the last textbox on the page
        // (first is search, second is message compose)
        const textboxes = document.querySelectorAll(SELECTORS.textbox);
        if (textboxes.length >= 2) {
            textboxes[textboxes.length - 1].focus();
            return true;
        }
        return false;
    }

    function focusSearch() {
        // The search textbox is the first one on the page
        const textbox = document.querySelector(SELECTORS.textbox);
        if (textbox) {
            textbox.focus();
            return true;
        }
        return false;
    }

    function enterSearchMode() {
        focusSearch();
        currentMode = MODE.INSERT;
        updateIndicator();
    }

    // --- Mode Switching ---
    function enterNormalMode(context) {
        currentMode = MODE.NORMAL;
        currentContext = context || CONTEXT.CHAT_LIST;
        // Blur any focused input to prevent lingering text insertion
        document.activeElement?.blur();
        updateIndicator();

        if (currentContext === CONTEXT.CHAT_LIST) {
            clearMessageHighlight();
            if (selectedChatIndex < 0) {
                const chats = getChatItems();
                if (chats.length > 0) {
                    highlightChat(0);
                }
            }
        } else if (currentContext === CONTEXT.CONVERSATION) {
            if (selectedMessageIndex < 0) {
                const messages = getMessageItems();
                if (messages.length > 0) {
                    highlightMessage(messages.length - 1);
                }
            }
        }
    }

    function enterInsertMode() {
        currentMode = MODE.INSERT;
        clearMessageHighlight();
        updateIndicator();
        focusMessageInput();
    }

    // --- Context-Specific Key Handlers ---
    function handleChatListKey(e) {
        const chats = getChatItems();

        switch (e.key) {
            case "j":
            case "ArrowDown": { // Next chat
                if (chats.length > 0) {
                    const next = Math.min(selectedChatIndex + 1, chats.length - 1);
                    highlightChat(next);
                }
                break;
            }

            case "k":
            case "ArrowUp": { // Previous chat
                if (chats.length > 0) {
                    const prev = Math.max(selectedChatIndex - 1, 0);
                    highlightChat(prev);
                }
                break;
            }

            case "Enter": { // Open selected chat and enter Insert mode
                openSelectedChat();
                setTimeout(() => enterInsertMode(), 150);
                break;
            }

            case "i": { // Enter Insert mode directly
                enterInsertMode();
                break;
            }

            case "/": { // Focus search
                enterSearchMode();
                break;
            }

            case "g": { // gg = first chat
                // The blanket blocker above calls stopPropagation(), which prevents
                // a dynamically-registered capture listener from seeing the second 'g'.
                // Use a module-level flag instead — the main handler checks it before
                // the blocker runs so the chord always completes correctly.
                _pendingGg = true;
                if (_pendingGgTimer) clearTimeout(_pendingGgTimer);
                _pendingGgTimer = setTimeout(() => { _pendingGg = false; _pendingGgTimer = null; }, 1000);
                break;
            }

            case "G": { // Last chat
                if (chats.length > 0) {
                    highlightChat(chats.length - 1);
                }
                break;
            }

            default:
                break;
        }
    }

    function handleConversationKey(e) {
        const messages = getMessageItems();

        switch (e.key) {
            case "j":
            case "ArrowDown": { // Next message
                if (messages.length > 0) {
                    const next = Math.min(selectedMessageIndex + 1, messages.length - 1);
                    highlightMessage(next);
                }
                break;
            }

            case "k":
            case "ArrowUp": { // Previous message
                if (messages.length > 0) {
                    const prev = Math.max(selectedMessageIndex - 1, 0);
                    highlightMessage(prev);
                }
                break;
            }

            case "i": { // Enter Insert mode
                enterInsertMode();
                break;
            }

            case "/": { // Focus search
                enterSearchMode();
                break;
            }

            case "g": { // gg = oldest visible message
                // See gg handler in handleChatListKey for explanation of why we use
                // a module-level flag instead of a dynamically-registered listener.
                _pendingGg = true;
                if (_pendingGgTimer) clearTimeout(_pendingGgTimer);
                _pendingGgTimer = setTimeout(() => { _pendingGg = false; _pendingGgTimer = null; }, 1000);
                break;
            }

            case "G": { // Newest visible message
                if (messages.length > 0) {
                    highlightMessage(messages.length - 1);
                }
                break;
            }

            case "d": { // Ctrl+D = half-page down
                if (e.ctrlKey) {
                    scrollConversation("down");
                }
                break;
            }

            case "u": { // Ctrl+U = half-page up
                if (e.ctrlKey) {
                    scrollConversation("up");
                }
                break;
            }

            default:
                break;
        }
    }

    // --- Key Handler ---
    document.addEventListener("keydown", function(e) {
        // Escape works across all modes and contexts
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (currentMode === MODE.INSERT) {
                if (isConversationOpen()) {
                    enterNormalMode(CONTEXT.CONVERSATION);
                } else {
                    enterNormalMode(CONTEXT.CHAT_LIST);
                }
            } else if (currentContext === CONTEXT.CONVERSATION) {
                enterNormalMode(CONTEXT.CHAT_LIST);
            }
            return;
        }

        // In INSERT mode, let all keys pass through to WhatsApp
        if (currentMode === MODE.INSERT) return;

        // Complete the gg chord BEFORE the blanket blocker below calls
        // stopPropagation(). Dynamically-registered capture listeners are
        // skipped once stopPropagation() fires, so we use a module-level flag
        // checked here — in the handler that was registered first.
        if (_pendingGg && e.key === "g") {
            _pendingGg = false;
            if (_pendingGgTimer) { clearTimeout(_pendingGgTimer); _pendingGgTimer = null; }
            e.preventDefault();
            e.stopPropagation();
            if (currentContext === CONTEXT.CHAT_LIST) {
                highlightChat(0);
            } else {
                const ggMsgs = getMessageItems();
                if (ggMsgs.length > 0) highlightMessage(0);
            }
            return;
        }
        // If a non-g key arrives while gg is pending, cancel the chord.
        if (_pendingGg) { _pendingGg = false; if (_pendingGgTimer) { clearTimeout(_pendingGgTimer); _pendingGgTimer = null; } }

        // --- NORMAL MODE: block ALL non-modifier keys from reaching WhatsApp ---
        // Allow Ctrl/Alt/Meta combinations to pass (system shortcuts like Ctrl+C)
        // but block everything else so no typing occurs in NORMAL mode.
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Tab toggles between CHAT_LIST and CONVERSATION contexts.
        // Must be handled here in JS because the blanket blocker above
        // calls stopPropagation, preventing Tab from reaching the QML layer.
        if (e.key === "Tab") {
            if (currentContext === CONTEXT.CHAT_LIST && isConversationOpen()) {
                enterNormalMode(CONTEXT.CONVERSATION);
            } else {
                enterNormalMode(CONTEXT.CHAT_LIST);
            }
            return;
        }

        if (DEBUG) updateDebugOverlay("Last key: " + e.key);

        // Dispatch to context-specific handler
        if (currentContext === CONTEXT.CHAT_LIST) {
            handleChatListKey(e);
        } else if (currentContext === CONTEXT.CONVERSATION) {
            handleConversationKey(e);
        }
    }, true); // capture phase — intercept before WhatsApp

    // Block keypress events in NORMAL mode as a safety net.
    // Some WebEngine versions allow text insertion via keypress even after
    // keydown preventDefault. This ensures no typing leaks through.
    document.addEventListener("keypress", function(e) {
        if (currentMode === MODE.NORMAL) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // Block beforeinput events in NORMAL mode — the most reliable way to
    // prevent contentEditable elements from accepting text.
    document.addEventListener("beforeinput", function(e) {
        if (currentMode === MODE.NORMAL) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // --- Bridge functions (called from QML via runJavaScript) ---
    window.__symmetriaToggleContext = function() {
        if (currentMode !== MODE.NORMAL) return;
        if (currentContext === CONTEXT.CHAT_LIST && isConversationOpen()) {
            enterNormalMode(CONTEXT.CONVERSATION);
        } else {
            enterNormalMode(CONTEXT.CHAT_LIST);
        }
    };

    // --- Initialize ---
    // WhatsApp is a SPA that renders progressively. Poll until the chat
    // list grid appears in the DOM, then enter NORMAL mode and select
    // the first chat. Gives up after 30 seconds.
    let initAttempts = 0;
    const initTimer = setInterval(() => {
        initAttempts++;
        const chats = getChatItems();
        if (DEBUG) updateDebugOverlay("Init poll #" + initAttempts + " (" + chats.length + " chats)");

        if (chats.length > 0) {
            clearInterval(initTimer);
            enterNormalMode(CONTEXT.CHAT_LIST);
            console.log("[Symmetria] Init complete: " + chats.length + " chats found after " + initAttempts + " polls");
        } else if (initAttempts >= 30) {
            clearInterval(initTimer);
            console.log("[Symmetria] Init gave up after 30 polls — no chats found");
        }
    }, 1000);

    // Keep the debug overlay refreshed while DEBUG is on
    if (DEBUG) {
        setInterval(() => updateDebugOverlay("Auto-scan"), 3000);
    }

    updateIndicator();
    console.log("[Symmetria] Keyboard navigation loaded (NORMAL mode)");
})();
