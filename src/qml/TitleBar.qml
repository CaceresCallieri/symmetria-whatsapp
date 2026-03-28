import QtQuick
import QtQuick.Layouts

Rectangle {
    id: titleBar

    property string currentTitle: "Symmetria WhatsApp"
    property var targetWindow: null

    height: 36
    color: "#1a1a2e"

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: 4
        spacing: 0

        // Title text
        Text {
            text: titleBar.currentTitle
            color: "#e0e0e0"
            font.pixelSize: 13
            font.family: "monospace"
            font.weight: Font.Medium
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        // Window control buttons
        Repeater {
            model: [
                { label: "−", action: "minimize" },
                { label: "□", action: "maximize" },
                { label: "✕", action: "close" }
            ]

            Rectangle {
                required property var modelData
                required property int index

                width: 36
                height: 28
                radius: 4
                color: buttonArea.containsMouse
                    ? (modelData.action === "close" ? "#e74c3c" : "#2a2a4a")
                    : "transparent"

                Text {
                    anchors.centerIn: parent
                    text: modelData.label
                    color: "#e0e0e0"
                    font.pixelSize: modelData.action === "close" ? 12 : 14
                }

                MouseArea {
                    id: buttonArea
                    anchors.fill: parent
                    hoverEnabled: true
                    onClicked: {
                        if (!titleBar.targetWindow) return;
                        switch (modelData.action) {
                            case "minimize":
                                titleBar.targetWindow.showMinimized();
                                break;
                            case "maximize":
                                if (titleBar.targetWindow.visibility === Window.Maximized)
                                    titleBar.targetWindow.showNormal();
                                else
                                    titleBar.targetWindow.showMaximized();
                                break;
                            case "close":
                                titleBar.targetWindow.close();
                                break;
                        }
                    }
                }
            }
        }
    }

    // Drag area (covers everything except the buttons on the right)
    MouseArea {
        anchors.fill: parent
        anchors.rightMargin: 116 // 3 buttons × ~36px + spacing
        onPressed: {
            if (titleBar.targetWindow)
                titleBar.targetWindow.startSystemMove();
        }
        onDoubleClicked: {
            if (!titleBar.targetWindow) return;
            if (titleBar.targetWindow.visibility === Window.Maximized)
                titleBar.targetWindow.showNormal();
            else
                titleBar.targetWindow.showMaximized();
        }
    }
}
