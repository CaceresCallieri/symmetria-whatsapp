import QtQuick
import QtWebEngine

Rectangle {
    id: accountView

    required property WebEngineProfile profile
    property int unreadCount: 0
    property bool navInjected: false

    radius: 12
    color: "#1a1a1a"
    clip: true

    WebEngineView {
        id: webView
        anchors.fill: parent
        profile: accountView.profile
        url: "https://web.whatsapp.com"

        onTitleChanged: function(title) {
            let match = title.match(/\((\d+)\)/);
            let count = match ? parseInt(match[1], 10) : 0;
            accountView.unreadCount = count;
        }

        onLoadingChanged: function(loadingInfo) {
            if (loadingInfo.status === WebEngineView.LoadSucceededStatus) {
                console.log("[Symmetria] WhatsApp Web loaded for profile:",
                    accountView.profile.storageName);
                injectKeyboardNav();
            } else if (loadingInfo.status === WebEngineView.LoadFailedStatus) {
                console.error("[Symmetria] Failed to load WhatsApp Web:",
                    loadingInfo.errorString);
            }
        }

        onPermissionRequested: function(request) {
            console.log("[Symmetria] Permission requested:", request.permissionType);
            request.grant();
        }

        onNewWindowRequested: function(request) {
            Qt.openUrlExternally(request.requestedUrl);
        }

        settings.javascriptEnabled: true
        settings.localStorageEnabled: true
        settings.javascriptCanAccessClipboard: true
        settings.javascriptCanPaste: true
        settings.localContentCanAccessRemoteUrls: true
        settings.scrollAnimatorEnabled: false
    }

    // Load JS from qrc and inject via runJavaScript after page load
    function injectKeyboardNav() {
        if (accountView.navInjected) return;

        var xhr = new XMLHttpRequest();
        xhr.open("GET", "qrc:///keyboard-nav.js", false);
        xhr.send();

        if (xhr.status === 200) {
            webView.runJavaScript(xhr.responseText, function(result) {
                console.log("[Symmetria] Keyboard nav injected for:",
                    accountView.profile.storageName);
            });
            accountView.navInjected = true;
        } else {
            console.error("[Symmetria] Failed to load keyboard-nav.js");
        }
    }
}
