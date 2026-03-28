import QtQuick
import QtQuick.Layouts
import QtWebEngine

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

    // --- Profiles ---
    WebEngineProfile {
        id: personalProfile
        storageName: "personal"
        persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
        httpUserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    }

    WebEngineProfile {
        id: workProfile
        storageName: "work"
        persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
        httpUserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    }

    // --- Account data model ---
    property int currentAccountIndex: 0
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

        // WebEngine views
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
