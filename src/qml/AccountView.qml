import QtQuick
import QtWebChannel
import QtWebEngine
import com.symmetria.whatsapp

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
        // HYBRID bridge: publishes the WhatsAppBridge object into the page so
        // the injected script can push scraped chat data back to native QML.
        webChannel: bridgeChannel

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
                // Inject the HYBRID data bridge (qwebchannel.js + extractor).
                accountView.injectBridge();
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

        // Forward [Symmetria]-tagged console output from the injected bridge
        // script to stdout so the spike is debuggable from the terminal.
        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {
            if (message.indexOf("[Symmetria]") !== -1)
                console.log(message);
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

    // --- HYBRID bridge (PRD Phase 2 spike) ---
    // The C++ data object, published into the page over QWebChannel as "bridge".
    WhatsAppBridge {
        id: bridge
        WebChannel.id: "bridge"
    }

    WebChannel {
        id: bridgeChannel
        registeredObjects: [bridge]
    }

    // Native QML panel rendering the chat list read live out of WhatsApp Web
    // through the bridge. Docked over the (right-hand) conversation area so it
    // sits beside WhatsApp's own left-hand chat list for easy side-by-side
    // comparison — visual proof the data-out direction works.
    Rectangle {
        id: bridgePanel
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.margins: 12
        width: 280
        radius: 10
        color: "#ee101418"
        border.color: "#3a4048"
        border.width: 1

        Column {
            anchors.fill: parent
            anchors.margins: 12
            spacing: 8

            Text {
                width: parent.width
                text: "Native bridge view (spike)\n" + bridge.chats.length
                      + " chats via QWebChannel"
                color: "#9fe6a0"
                font.pixelSize: 12
                font.bold: true
                wrapMode: Text.WordWrap
            }

            ListView {
                width: parent.width
                height: parent.height - 128
                clip: true
                model: bridge.chats
                spacing: 2

                delegate: Row {
                    width: ListView.view ? ListView.view.width : 0
                    spacing: 6

                    Text {
                        width: parent.width - 30
                        text: modelData.title
                        color: "white"
                        font.pixelSize: 13
                        elide: Text.ElideRight
                    }

                    Rectangle {
                        visible: modelData.unread > 0
                        width: 22; height: 18; radius: 9
                        color: "#25d366"
                        Text {
                            anchors.centerIn: parent
                            text: modelData.unread
                            color: "#0b141a"
                            font.pixelSize: 11
                            font.bold: true
                        }
                    }
                }
            }

            // --- Action-direction spike: native input → bridge → WhatsApp Web ---
            Column {
                width: parent.width
                spacing: 6

                Rectangle {
                    width: parent.width
                    height: 34
                    radius: 6
                    color: "#0b141a"
                    border.color: msgInput.activeFocus ? "#25d366" : "#3a4048"
                    border.width: 1

                    TextInput {
                        id: msgInput
                        anchors.fill: parent
                        anchors.margins: 8
                        verticalAlignment: TextInput.AlignVCenter
                        color: "white"
                        font.pixelSize: 13
                        clip: true
                        // Enter inserts only (safe) — the field never auto-sends.
                        onAccepted: bridge.requestSend(text, false)

                        Text {
                            anchors.fill: parent
                            verticalAlignment: Text.AlignVCenter
                            visible: !msgInput.text && !msgInput.activeFocus
                            text: "Type to test the bridge…"
                            color: "#5a6068"
                            font: msgInput.font
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: 6

                    // Insert into WhatsApp's compose box WITHOUT sending (safe).
                    Rectangle {
                        width: (parent.width - 6) / 2
                        height: 30
                        radius: 6
                        color: insertMA.pressed ? "#1f6f43" : "#2a3942"
                        opacity: msgInput.text.length > 0 ? 1 : 0.5
                        Text {
                            anchors.centerIn: parent
                            text: "Insert"
                            color: "white"
                            font.pixelSize: 12
                        }
                        MouseArea {
                            id: insertMA
                            anchors.fill: parent
                            enabled: msgInput.text.length > 0
                            onClicked: bridge.requestSend(msgInput.text, false)
                        }
                    }

                    // Insert AND send to the currently-open chat.
                    Rectangle {
                        width: (parent.width - 6) / 2
                        height: 30
                        radius: 6
                        color: sendMA.pressed ? "#1f6f43" : "#25d366"
                        opacity: msgInput.text.length > 0 ? 1 : 0.5
                        Text {
                            anchors.centerIn: parent
                            text: "Send"
                            color: "#0b141a"
                            font.pixelSize: 12
                            font.bold: true
                        }
                        MouseArea {
                            id: sendMA
                            anchors.fill: parent
                            enabled: msgInput.text.length > 0
                            onClicked: {
                                bridge.requestSend(msgInput.text, true);
                                msgInput.text = "";
                            }
                        }
                    }
                }
            }
        }
    }

    function grabFocus() {
        webView.forceActiveFocus();
    }

    function reload() {
        webView.reload();
        console.log("[Symmetria] Reloading profile:", accountView.profile.storageName);
    }

    // Inject Qt's QWebChannel client library, then our minimal chat-list
    // extractor, into the embedded WhatsApp Web page. Synchronous XHR from QRC
    // mirrors the proven loader pattern; sequential runJavaScript calls execute
    // in page order, so qwebchannel.js is defined before the bridge uses it.
    function injectBridge() {
        var libXhr = new XMLHttpRequest();
        libXhr.open("GET", "qrc:///qwebchannel.js", false);
        libXhr.send();
        if (libXhr.status !== 200) {
            console.error("[Symmetria] Failed to load qwebchannel.js — status:",
                libXhr.status);
            return;
        }
        webView.runJavaScript(libXhr.responseText);

        var brXhr = new XMLHttpRequest();
        brXhr.open("GET", "qrc:///whatsapp-bridge.js", false);
        brXhr.send();
        if (brXhr.status !== 200) {
            console.error("[Symmetria] Failed to load whatsapp-bridge.js — status:",
                brXhr.status);
            return;
        }
        webView.runJavaScript(brXhr.responseText);
        console.log("[Symmetria] HYBRID bridge injected for:",
            accountView.profile.storageName);
    }
}
