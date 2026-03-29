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

        onTitleChanged: function(pageTitle) {
            if (!pageTitle) return;
            let match = pageTitle.match(/\((\d+)\)/);
            let count = match ? parseInt(match[1], 10) : 0;
            accountView.unreadCount = count;
        }

        onLoadingChanged: function(loadingInfo) {
            if (loadingInfo.status === WebEngineView.LoadSucceededStatus) {
                console.log("[Symmetria] WhatsApp Web loaded for profile:",
                    accountView.profile.storageName);
                accountView.injectKeyboardNav();
            } else if (loadingInfo.status === WebEngineView.LoadFailedStatus) {
                console.error("[Symmetria] Failed to load WhatsApp Web:",
                    loadingInfo.errorString);
                // Reset injection flag so a subsequent successful reload
                // re-injects keyboard nav rather than silently skipping it.
                accountView.navInjected = false;
            }
        }

        onPermissionRequested: function(request) {
            console.log("[Symmetria] Permission requested:", request.permissionType);
            // Grant only the permissions WhatsApp Web legitimately needs.
            // Camera, geolocation, and desktop capture are denied to prevent
            // any rogue content from silently accessing sensitive hardware.
            switch (request.permissionType) {
                case WebEnginePermission.MediaAudioCapture:
                case WebEnginePermission.Notifications:
                    request.grant();
                    break;
                default:
                    console.warn("[Symmetria] Denied permission:", request.permissionType);
                    request.deny();
                    break;
            }
        }

        onNewWindowRequested: function(request) {
            Qt.openUrlExternally(request.requestedUrl);
        }

        settings.javascriptEnabled: true
        settings.localStorageEnabled: true
        // javascriptCanAccessClipboard grants read+write clipboard access; WhatsApp
        // Web only needs paste. Disable broad clipboard access and keep paste only.
        settings.javascriptCanAccessClipboard: false
        settings.javascriptCanPaste: true
        settings.playbackRequiresUserGesture: false
        settings.scrollAnimatorEnabled: false
    }

    function injectKeyboardNav() {
        if (accountView.navInjected) return;

        var xhr = new XMLHttpRequest();
        xhr.open("GET", "qrc:///keyboard-nav.js", false);
        xhr.send();

        if (xhr.status === 200) {
            webView.runJavaScript(xhr.responseText);
            accountView.navInjected = true;
            console.log("[Symmetria] Keyboard nav injected for:",
                accountView.profile.storageName);
        } else {
            console.error("[Symmetria] Failed to load keyboard-nav.js from QRC — status:",
                xhr.status, "profile:", accountView.profile.storageName);
        }
    }
}
