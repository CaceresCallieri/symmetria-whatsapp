#ifndef DOWNLOADHANDLER_H
#define DOWNLOADHANDLER_H

#include <QObject>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusPendingReply>
#include <QDBusObjectPath>
#include <QDBusPendingCallWatcher>
#include <QRandomGenerator>
#include <QUrl>
#include <QFile>
#include <QtWebEngineQuick/qquickwebengineprofile.h>
#include <QtWebEngineQuick/qquickwebenginedownloadrequest.h>

// Handles file downloads by showing a native Save As dialog via the
// XDG Desktop Portal's FileChooser interface. This bypasses Qt's
// platform-theme-dependent FileDialog (which falls back to a custom
// widget on Hyprland/qt6ct) and goes straight to the portal, which
// routes to the user's configured file manager.
//
// Falls back to auto-saving to ~/Downloads if the portal is unavailable.
class DownloadHandler : public QObject
{
    Q_OBJECT

public:
    explicit DownloadHandler(QObject *parent = nullptr)
        : QObject(parent)
    {}

    void attachToProfile(QQuickWebEngineProfile *profile)
    {
        connect(profile, &QQuickWebEngineProfile::downloadRequested,
                this, &DownloadHandler::onDownloadRequested);
    }

private slots:
    void onDownloadRequested(QQuickWebEngineDownloadRequest *download)
    {
        if (m_pendingDownload) {
            // A save dialog is already open — auto-save this download.
            qInfo() << "[Symmetria] Download auto-saved (dialog busy):"
                    << download->suggestedFileName()
                    << "→" << download->downloadDirectory();
            download->accept();
            return;
        }

        download->pause();
        m_pendingDownload = download;

        // Clean up if WebEngine destroys the download while the dialog is open.
        connect(download, &QObject::destroyed, this, [this]() {
            m_pendingDownload = nullptr;
        });

        // Use the race-free pattern: subscribe to the Response signal BEFORE
        // calling SaveFile, using a predictable request object path built from
        // the handle_token we provide.
        QString sender = QDBusConnection::sessionBus().baseService();
        sender.remove(0, 1);           // strip leading ':'
        sender.replace(QLatin1Char('.'), QLatin1Char('_'));

        QString token = QStringLiteral("symmetria_%1")
            .arg(QRandomGenerator::global()->generate());
        QString requestPath = QStringLiteral(
            "/org/freedesktop/portal/desktop/request/%1/%2")
            .arg(sender, token);

        // Subscribe to the response BEFORE making the call (avoids race).
        QDBusConnection::sessionBus().connect(
            QString(),                                      // any sender
            requestPath,
            QStringLiteral("org.freedesktop.portal.Request"),
            QStringLiteral("Response"),
            this,
            SLOT(onPortalResponse(uint,QVariantMap)));

        // Build the SaveFile D-Bus call.
        QDBusMessage msg = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.portal.Desktop"),
            QStringLiteral("/org/freedesktop/portal/desktop"),
            QStringLiteral("org.freedesktop.portal.FileChooser"),
            QStringLiteral("SaveFile"));

        QVariantMap options;
        options[QStringLiteral("handle_token")] = token;
        options[QStringLiteral("current_name")] = download->suggestedFileName();
        // current_folder must be a null-terminated byte array (D-Bus type ay).
        options[QStringLiteral("current_folder")] =
            QFile::encodeName(download->downloadDirectory()).append('\0');

        msg << QString()                         // parent_window (empty = unparented)
            << QStringLiteral("Save file")       // dialog title
            << options;

        QDBusPendingCall pending = QDBusConnection::sessionBus().asyncCall(msg);
        auto *watcher = new QDBusPendingCallWatcher(pending, this);

        connect(watcher, &QDBusPendingCallWatcher::finished, this,
                [this, requestPath](QDBusPendingCallWatcher *w) {
            QDBusPendingReply<QDBusObjectPath> reply = *w;
            w->deleteLater();

            if (reply.isError()) {
                qWarning() << "[Symmetria] Portal FileChooser unavailable:"
                           << reply.error().message()
                           << "— falling back to auto-save";
                // Disconnect the pre-subscribed signal.
                QDBusConnection::sessionBus().disconnect(
                    QString(), requestPath,
                    QStringLiteral("org.freedesktop.portal.Request"),
                    QStringLiteral("Response"),
                    this, SLOT(onPortalResponse(uint,QVariantMap)));

                if (m_pendingDownload) {
                    m_pendingDownload->resume();
                    m_pendingDownload->accept();
                    m_pendingDownload = nullptr;
                }
            }
        });
    }

    void onPortalResponse(uint response, const QVariantMap &results)
    {
        if (!m_pendingDownload) return;

        if (response == 0) {
            // User selected a file.
            QStringList uris = results.value(QStringLiteral("uris")).toStringList();
            if (!uris.isEmpty()) {
                QString path = QUrl(uris.first()).toLocalFile();
                int sep = path.lastIndexOf(QLatin1Char('/'));
                m_pendingDownload->setDownloadDirectory(path.left(sep));
                m_pendingDownload->setDownloadFileName(path.mid(sep + 1));
                qInfo() << "[Symmetria] Download saved:"
                        << m_pendingDownload->downloadFileName()
                        << "→" << m_pendingDownload->downloadDirectory();
                m_pendingDownload->accept();
            } else {
                qInfo() << "[Symmetria] Download cancelled (empty URI list)";
                m_pendingDownload->cancel();
            }
        } else {
            qInfo() << "[Symmetria] Download cancelled by user";
            m_pendingDownload->cancel();
        }

        m_pendingDownload = nullptr;
    }

private:
    QQuickWebEngineDownloadRequest *m_pendingDownload = nullptr;
};

#endif // DOWNLOADHANDLER_H
