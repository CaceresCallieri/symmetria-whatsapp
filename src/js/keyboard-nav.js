(function() {
    "use strict";

    const MODE = { NORMAL: "NORMAL", INSERT: "INSERT" };
    let currentMode = MODE.INSERT; // Start in INSERT so WhatsApp loads normally

    const SELECTORS = {
        chatList: "[data-testid='chat-list']",
        chatItem: "[role='listitem']",
        conversationPanel: "[data-testid='conversation-panel']",
        messageInput: "[data-testid='conversation-compose-box-input']",
        searchInput: "[data-testid='search']",
    };

    let selectedChatIndex = -1;

    // --- Mode Indicator Overlay ---
    const indicator = document.createElement("div");
    indicator.id = "symmetria-mode-indicator";
    Object.assign(indicator.style, {
        position: "fixed",
        bottom: "8px",
        right: "8px",
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

    function updateIndicator() {
        indicator.textContent = currentMode;
        if (currentMode === MODE.NORMAL) {
            indicator.style.backgroundColor = "#5af78e";
            indicator.style.color = "#1a1a2e";
            indicator.style.opacity = "0.9";
        } else {
            indicator.style.opacity = "0";
        }
    }

    // --- Chat Navigation ---
    function getChatItems() {
        const chatList = document.querySelector(SELECTORS.chatList);
        if (!chatList) return [];
        return Array.from(chatList.querySelectorAll(SELECTORS.chatItem));
    }

    function highlightChat(index) {
        const chats = getChatItems();
        // Clear previous highlights
        chats.forEach(chat => {
            chat.style.outline = "";
        });

        if (index >= 0 && index < chats.length) {
            selectedChatIndex = index;
            const target = chats[index];
            target.style.outline = "2px solid #5af78e";
            target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }

    function openSelectedChat() {
        const chats = getChatItems();
        if (selectedChatIndex >= 0 && selectedChatIndex < chats.length) {
            const target = chats[selectedChatIndex];
            // Find the clickable container inside the list item
            const clickable = target.querySelector("[data-testid='cell-frame-container']") || target;
            clickable.click();
        }
    }

    function focusMessageInput() {
        const input = document.querySelector(SELECTORS.messageInput);
        if (input) {
            input.focus();
            return true;
        }
        return false;
    }

    function focusSearch() {
        const search = document.querySelector(SELECTORS.searchInput);
        if (search) {
            search.focus();
            return true;
        }
        // Fallback: try the search button
        const searchBtn = document.querySelector("[data-testid='chat-list-search']");
        if (searchBtn) {
            searchBtn.click();
            return true;
        }
        return false;
    }

    function isInputFocused() {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea") return true;
        if (active.contentEditable === "true") return true;
        if (active.getAttribute("role") === "textbox") return true;
        return false;
    }

    // --- Mode Switching ---
    function enterNormalMode() {
        currentMode = MODE.NORMAL;
        document.activeElement?.blur();
        updateIndicator();

        // If no chat is selected yet, select the first one
        if (selectedChatIndex < 0) {
            const chats = getChatItems();
            if (chats.length > 0) {
                highlightChat(0);
            }
        }
    }

    function enterInsertMode() {
        currentMode = MODE.INSERT;
        updateIndicator();
        focusMessageInput();
    }

    // --- Key Handler ---
    document.addEventListener("keydown", function(e) {
        // Escape always returns to Normal mode (unless already in Normal)
        if (e.key === "Escape") {
            if (currentMode === MODE.INSERT) {
                e.preventDefault();
                e.stopPropagation();
                enterNormalMode();
                return;
            }
        }

        // In INSERT mode, let all keys pass through to WhatsApp
        if (currentMode === MODE.INSERT) return;

        // --- NORMAL MODE bindings ---
        const chats = getChatItems();

        switch (e.key) {
            case "j": // Next chat
                e.preventDefault();
                e.stopPropagation();
                if (chats.length > 0) {
                    const next = Math.min(selectedChatIndex + 1, chats.length - 1);
                    highlightChat(next);
                }
                break;

            case "k": // Previous chat
                e.preventDefault();
                e.stopPropagation();
                if (chats.length > 0) {
                    const prev = Math.max(selectedChatIndex - 1, 0);
                    highlightChat(prev);
                }
                break;

            case "Enter": // Open selected chat and enter Insert mode
                e.preventDefault();
                e.stopPropagation();
                openSelectedChat();
                // Brief delay to let WhatsApp render the conversation
                setTimeout(() => enterInsertMode(), 150);
                break;

            case "i": // Enter Insert mode directly
                e.preventDefault();
                e.stopPropagation();
                enterInsertMode();
                break;

            case "/": // Focus search
                e.preventDefault();
                e.stopPropagation();
                focusSearch();
                currentMode = MODE.INSERT; // Search needs typing
                updateIndicator();
                break;

            case "g": // gg = first chat (wait for second g)
                e.preventDefault();
                e.stopPropagation();
                // Simple gg: listen for next key
                const ggHandler = function(e2) {
                    document.removeEventListener("keydown", ggHandler, true);
                    if (e2.key === "g") {
                        e2.preventDefault();
                        e2.stopPropagation();
                        highlightChat(0);
                    }
                };
                document.addEventListener("keydown", ggHandler, true);
                // Timeout to cancel if no second key
                setTimeout(() => {
                    document.removeEventListener("keydown", ggHandler, true);
                }, 500);
                break;

            case "G": // Last chat
                e.preventDefault();
                e.stopPropagation();
                if (chats.length > 0) {
                    highlightChat(chats.length - 1);
                }
                break;

            default:
                break;
        }
    }, true); // capture phase — intercept before WhatsApp

    // Initialize
    updateIndicator();
    console.log("[Symmetria] Keyboard navigation loaded");
})();
