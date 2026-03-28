import QtQuick
import QtWebEngine

Rectangle {
    id: accountView

    required property WebEngineProfile profile
    property int unreadCount: 0

    radius: 12
    color: "#1a1a1a"
    clip: true

    // Inject keyboard navigation via WebEngineScript so it is bound
    // to the profile lifecycle rather than managed manually per load.
    // Injection happens at DocumentReady, which fires after each full
    // page load — no manual navInjected flag needed.
    WebEngineScript {
        id: keyboardNavScript
        name: "symmetria-keyboard-nav"
        sourceUrl: "qrc:///keyboard-nav.js"
        injectionPoint: WebEngineScript.DocumentReady
        worldId: WebEngineScript.MainWorld
    }

    Component.onCompleted: {
        accountView.profile.scripts.insert(keyboardNavScript);
    }

    WebEngineView {
        id: webView
        anchors.fill: parent
        profile: accountView.profile
        url: "https://web.whatsapp.com"

        onTitleChanged: function(pageTitle) {
            let match = pageTitle.match(/\((\d+)\)/);
            let count = match ? parseInt(match[1], 10) : 0;
            accountView.unreadCount = count;
        }

        onLoadingChanged: function(loadingInfo) {
            if (loadingInfo.status === WebEngineView.LoadSucceededStatus) {
                console.log("[Symmetria] WhatsApp Web loaded for profile:",
                    accountView.profile.storageName);
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
        settings.javascriptCanAccessClipboard: true
        settings.javascriptCanPaste: true
        // localContentCanAccessRemoteUrls is not needed — this view loads
        // only remote content (web.whatsapp.com). Enabling it would weaken
        // cross-origin policy without benefit.
        settings.scrollAnimatorEnabled: false
    }
}
