import QtQuick
import QtQuick.Layouts

Rectangle {
    id: titleBar

    property string currentTitle: "Symmetria WhatsApp"
    property var targetWindow: null

    // Button geometry constants — used both in the Repeater delegate and
    // in the drag area margin so the values stay in sync automatically.
    readonly property int buttonWidth: 36
    readonly property int buttonCount: 3
    readonly property int layoutRightMargin: 4

    height: 36
    color: "#1a1a2e"

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: titleBar.layoutRightMargin
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

                width: titleBar.buttonWidth
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

    // Drag area covers everything except the window control buttons.
    // The right margin is derived from button geometry constants so it
    // stays correct if button width or count changes.
    MouseArea {
        anchors.fill: parent
        anchors.rightMargin: titleBar.buttonCount * titleBar.buttonWidth + titleBar.layoutRightMargin
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
