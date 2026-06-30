import QtQuick
import QtWebEngine

Rectangle {
    id: accountView

    required property WebEngineProfile profile
    property int unreadCount: 0

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
                // Give the view keyboard focus so the user can interact
                // immediately without a click.
                webView.forceActiveFocus();
            } else if (loadingInfo.status === WebEngineView.LoadFailedStatus) {
                console.error("[Symmetria] Failed to load WhatsApp Web:",
                    loadingInfo.errorString);
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

    function grabFocus() {
        webView.forceActiveFocus();
    }

    function reload() {
        webView.reload();
        console.log("[Symmetria] Reloading profile:", accountView.profile.storageName);
    }
}
