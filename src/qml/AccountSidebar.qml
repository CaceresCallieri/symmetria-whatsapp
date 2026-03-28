import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: sidebar

    property int selectedIndex: 0
    property var accountModel: []

    signal accountSelected(int index)

    width: 48
    color: "transparent"

    ColumnLayout {
        anchors.fill: parent
        anchors.topMargin: 10
        anchors.bottomMargin: 10
        spacing: 8

        // Account buttons — black matte pills
        Repeater {
            model: sidebar.accountModel

            Rectangle {
                required property var modelData
                required property int index

                Layout.alignment: Qt.AlignHCenter
                width: 36
                height: 36
                radius: 18
                color: sidebar.selectedIndex === index
                    ? "#1a1a1a"
                    : "#0d0d0d"
                opacity: sidebar.selectedIndex === index ? 1.0 : 0.7
                border.width: sidebar.selectedIndex === index ? 1.5 : 0
                border.color: "#3a3a3a"

                Behavior on opacity { NumberAnimation { duration: 150 } }
                Behavior on color { ColorAnimation { duration: 150 } }

                Text {
                    anchors.centerIn: parent
                    text: modelData.initial
                    color: sidebar.selectedIndex === index ? "#ffffff" : "#999999"
                    font.pixelSize: 14
                    font.weight: Font.DemiBold
                    font.family: "monospace"

                    Behavior on color { ColorAnimation { duration: 150 } }
                }

                // Unread badge
                Rectangle {
                    visible: modelData.unreadCount > 0
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.topMargin: -3
                    anchors.rightMargin: -3
                    width: Math.max(16, badgeText.implicitWidth + 6)
                    height: 16
                    radius: 8
                    color: "#25d366"

                    Text {
                        id: badgeText
                        anchors.centerIn: parent
                        text: modelData.unreadCount > 99 ? "99+" : modelData.unreadCount
                        color: "#000000"
                        font.pixelSize: 9
                        font.weight: Font.Bold
                        font.family: "monospace"
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    hoverEnabled: true
                    onClicked: sidebar.accountSelected(index)
                    onEntered: parent.opacity = 1.0
                    onExited: {
                        if (sidebar.selectedIndex !== index)
                            parent.opacity = 0.7;
                    }
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
