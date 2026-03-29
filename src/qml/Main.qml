import QtQuick
import QtQuick.Layouts
import QtWebEngine
import com.symmetria.whatsapp

Window {
    id: root

    width: 1200
    height: 800
    minimumWidth: 600
    minimumHeight: 400
    visible: true
    title: "Symmetria WhatsApp"
    color: "transparent"
    flags: Qt.FramelessWindowHint | Qt.Window

    // Profiles are created in C++ (ProfileSetup singleton) to guarantee
    // the storageName is set at construction time. QML's WebEngineProfile
    // creates the browser context before property bindings are applied,
    // which causes profiles to start off-the-record on Qt 6.9+.
    property var personalProfile: ProfileSetup.personalProfile
    property var workProfile: ProfileSetup.workProfile

    // --- Account data model ---
    property int currentAccountIndex: 0
    // NOTE: Adding a new account requires updating three places:
    //   1. This accounts array (display metadata)
    //   2. A new WebEngineProfile above (for isolated storage)
    //   3. A new AccountView inside accountStack below
    property var accounts: [
        { name: "Personal", initial: "P", unreadCount: 0 },
        { name: "Work",     initial: "W", unreadCount: 0 }
    ]

    function switchAccount(index) {
        if (index < 0 || index >= accounts.length) return;
        currentAccountIndex = index;
        accountStack.currentIndex = index;
    }

    function updateUnreadCount(accountIndex, count) {
        let updated = accounts.slice();
        updated[accountIndex] = Object.assign({}, updated[accountIndex], { unreadCount: count });
        accounts = updated;
    }

    // --- Keyboard shortcuts for account switching ---
    Shortcut {
        sequence: "Ctrl+1"
        onActivated: switchAccount(0)
    }
    Shortcut {
        sequence: "Ctrl+2"
        onActivated: switchAccount(1)
    }
    Shortcut {
        sequence: "Ctrl+Tab"
        onActivated: switchAccount((currentAccountIndex + 1) % accounts.length)
    }
    Shortcut {
        sequence: "Ctrl+Shift+Tab"
        onActivated: switchAccount((currentAccountIndex - 1 + accounts.length) % accounts.length)
    }

    // --- Layout: sidebar + webview ---
    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Account sidebar (transparent with matte pills)
        AccountSidebar {
            id: accountSidebar
            Layout.fillHeight: true
            selectedIndex: root.currentAccountIndex
            accountModel: root.accounts

            onAccountSelected: function(index) {
                root.switchAccount(index);
            }
        }

        // WebEngine views — both created eagerly at startup so each
        // profile's network stack and storage are ready immediately.
        // With only 2 accounts this is acceptable; if the account count
        // grows, consider switching to Loader with active: false.
        StackLayout {
            id: accountStack
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: root.currentAccountIndex

            AccountView {
                id: personalView
                profile: personalProfile
                onUnreadCountChanged: root.updateUnreadCount(0, unreadCount)
            }

            AccountView {
                id: workView
                profile: workProfile
                onUnreadCountChanged: root.updateUnreadCount(1, unreadCount)
            }
        }
    }

    Component.onCompleted: {
        console.log("[Symmetria] WhatsApp wrapper initialized");
    }
}
