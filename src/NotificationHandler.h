#ifndef NOTIFICATIONHANDLER_H
#define NOTIFICATIONHANDLER_H

#include <QObject>
#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusPendingReply>
#include <QDBusPendingCallWatcher>
#include <QGuiApplication>
#include <QImage>
#include <QPointer>
#include <QWindow>
#include <QtWebEngineQuick/qquickwebengineprofile.h>
#include <QWebEngineNotification>

// Forwards WhatsApp Web notifications to the system notification daemon
// (swaync) via the org.freedesktop.Notifications D-Bus interface.
//
// Handles the full notification lifecycle:
//   - Web → system: presentNotification signal → D-Bus Notify call
//   - System → web: ActionInvoked (user click) → notification->click()
//   - Web → system: notification closed() → D-Bus CloseNotification
//   - System → web: NotificationClosed → notification->close()
//   - Tag-based replacement: avoids stacking duplicates from the same chat
//
// A single handler is shared across all profiles. The account name is passed
// during attachToProfile() to disambiguate multi-account notifications.
class NotificationHandler : public QObject
{
    Q_OBJECT

public:
    explicit NotificationHandler(QObject *parent = nullptr)
        : QObject(parent)
    {
        // Subscribe to D-Bus signals for user interactions with notifications.
        // ActionInvoked fires when the user clicks a notification action in swaync.
        // NotificationClosed fires when a notification is dismissed or expires.
        QDBusConnection::sessionBus().connect(
            QString(),
            QStringLiteral("/org/freedesktop/Notifications"),
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("ActionInvoked"),
            this, SLOT(onActionInvoked(uint,QString)));

        QDBusConnection::sessionBus().connect(
            QString(),
            QStringLiteral("/org/freedesktop/Notifications"),
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("NotificationClosed"),
            this, SLOT(onNotificationClosed(uint,uint)));
    }

    void attachToProfile(QQuickWebEngineProfile *profile,
                         const QString &accountName)
    {
        connect(profile, &QQuickWebEngineProfile::presentNotification,
                this, [this, accountName](QWebEngineNotification *notification) {
                    onNotification(notification, accountName);
                });
    }

signals:
    // Emitted when the user clicks a notification in swaync.
    // accountName matches the storageName ("personal", "work") so QML can
    // map it to the correct account index.
    void notificationClicked(const QString &accountName);

private:
    struct ActiveNotification {
        QPointer<QWebEngineNotification> webNotification;
        QString accountName;
    };

    // Maps D-Bus notification ID → tracked state. Entries are added when
    // the Notify reply arrives and removed on close/dismiss from either side.
    QHash<uint, ActiveNotification> m_active;

    void onNotification(QWebEngineNotification *notification,
                        const QString &accountName)
    {
        // Tag-based replacement: if an existing D-Bus notification matches
        // (same tag + origin), replace it instead of stacking a duplicate.
        // WhatsApp uses tags to group messages from the same chat.
        uint replacesId = 0;
        for (auto it = m_active.constBegin(); it != m_active.constEnd(); ++it) {
            if (it->webNotification && it->webNotification->matches(notification)) {
                replacesId = it.key();
                break;
            }
        }

        QDBusMessage msg = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("/org/freedesktop/Notifications"),
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("Notify"));

        // Prefix the title with the account name so the user can tell which
        // account received the message when multiple are active.
        QString summary = QStringLiteral("[%1] %2").arg(accountName,
                                                        notification->title());
        QString body = notification->message();

        // "default" is the standard action key for clicking the notification body.
        QStringList actions = {QStringLiteral("default"), QStringLiteral("Open")};

        QVariantMap hints;
        hints[QStringLiteral("desktop-entry")] =
            QStringLiteral("symmetria-whatsapp");
        hints[QStringLiteral("urgency")] = QVariant::fromValue<uchar>(1);

        // Embed the contact photo from WhatsApp if available. This shows the
        // sender's profile picture in swaync instead of a generic app icon.
        QImage icon = notification->icon();
        if (!icon.isNull()) {
            // The freedesktop image-data hint expects (iiibiiay):
            //   width, height, rowstride, hasAlpha, bitsPerSample, channels, data
            QImage img = icon.convertedTo(QImage::Format_RGBA8888);
            QDBusArgument imageArg;
            imageArg.beginStructure();
            imageArg << qint32(img.width())
                     << qint32(img.height())
                     << qint32(img.bytesPerLine())
                     << true              // hasAlpha
                     << qint32(8)         // bitsPerSample
                     << qint32(4)         // channels (RGBA)
                     << QByteArray(reinterpret_cast<const char *>(img.constBits()),
                                   img.sizeInBytes());
            imageArg.endStructure();
            hints[QStringLiteral("image-data")] =
                QVariant::fromValue(imageArg);
        }

        msg << QStringLiteral("Symmetria WhatsApp")   // app_name
            << replacesId                               // replaces_id
            << QStringLiteral("symmetria-whatsapp")    // app_icon (XDG icon name)
            << summary
            << body
            << actions
            << hints
            << qint32(-1);                              // expire_timeout (server default)

        QDBusPendingCall pending =
            QDBusConnection::sessionBus().asyncCall(msg);
        auto *watcher = new QDBusPendingCallWatcher(pending, this);

        // QWebEngineNotification has JavaScript ownership — QML's GC can
        // collect it at any time. QPointer detects this safely.
        QPointer<QWebEngineNotification> safeNotification = notification;

        connect(watcher, &QDBusPendingCallWatcher::finished, this,
                [this, safeNotification, accountName,
                 replacesId](QDBusPendingCallWatcher *w) {
            QDBusPendingReply<uint> reply = *w;
            w->deleteLater();

            if (reply.isError()) {
                qWarning() << "[Symmetria] D-Bus Notify failed:"
                           << reply.error().message();
                return;
            }

            uint dbusId = reply.value();

            // Clean up the replaced entry.
            if (replacesId > 0)
                m_active.remove(replacesId);

            if (!safeNotification) {
                qWarning() << "[Symmetria] Notification GC'd before D-Bus reply";
                return;
            }

            m_active[dbusId] = {safeNotification, accountName};

            // Tell WhatsApp Web the notification was successfully displayed.
            safeNotification->show();

            // Bidirectional sync: if WhatsApp closes the notification (message
            // read on another device), dismiss the D-Bus notification too.
            connect(safeNotification.data(), &QWebEngineNotification::closed,
                    this, [this, dbusId]() {
                closeDBusNotification(dbusId);
                m_active.remove(dbusId);
            });

            qInfo() << "[Symmetria] Notification sent:" << dbusId
                    << "account:" << accountName;
        });
    }

    void closeDBusNotification(uint id)
    {
        QDBusMessage msg = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("/org/freedesktop/Notifications"),
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("CloseNotification"));
        msg << id;
        QDBusConnection::sessionBus().asyncCall(msg);
    }

    void raiseWindow()
    {
        // Find the application window and bring it to the foreground.
        // On Wayland/Hyprland, requestActivate() sends xdg_activation_v1
        // which the compositor uses to focus the window.
        const auto windows = QGuiApplication::topLevelWindows();
        for (QWindow *w : windows) {
            if (w->isVisible()) {
                w->raise();
                w->requestActivate();
                return;
            }
        }
    }

private slots:
    void onActionInvoked(uint id, const QString &actionKey)
    {
        auto it = m_active.find(id);
        if (it == m_active.end()) return;

        if (actionKey == QStringLiteral("default")) {
            raiseWindow();

            // Tell WhatsApp Web the notification was clicked — this triggers
            // WhatsApp's own click handler (e.g., navigating to the chat).
            if (it->webNotification)
                it->webNotification->click();

            emit notificationClicked(it->accountName);
        }

        if (it->webNotification)
            it->webNotification->close();
        m_active.erase(it);
    }

    void onNotificationClosed(uint id, uint reason)
    {
        Q_UNUSED(reason);
        auto it = m_active.find(id);
        if (it == m_active.end()) return;

        // Inform the web page the notification was dismissed so it can
        // fire its onclose handler and update badge counts.
        if (it->webNotification)
            it->webNotification->close();
        m_active.erase(it);
    }
};

#endif // NOTIFICATIONHANDLER_H
