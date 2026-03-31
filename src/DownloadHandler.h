#ifndef DOWNLOADHANDLER_H
#define DOWNLOADHANDLER_H

#include <QObject>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusPendingReply>
#include <QDBusObjectPath>
#include <QDBusPendingCallWatcher>
#include <QFileInfo>
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
//
// NOTE: A single DownloadHandler is shared across all profiles. Concurrent
// downloads from different profiles are serialized: if a Save dialog is
// already open, subsequent downloads are auto-saved to their default directory.
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
            // A save dialog is already open — resume and auto-save this download
            // to its default directory rather than blocking it.
            qInfo() << "[Symmetria] Download auto-saved (dialog busy):"
                    << download->suggestedFileName()
                    << "→" << download->downloadDirectory();
            download->resume();
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
        //
        // XDG portal request path spec: the sender name is the D-Bus unique
        // connection name with the leading ':' stripped and '.' replaced by '_'.
        QString sender = QDBusConnection::sessionBus().baseService();
        sender.remove(0, 1);
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
        // Qt's QDBus layer marshals QByteArray stored in a QVariantMap as "ay"
        // automatically — no explicit type annotation is needed.
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
                // Disconnect the pre-subscribed signal so it does not fire later.
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
                const QFileInfo fileInfo(QUrl(uris.first()).toLocalFile());
                m_pendingDownload->setDownloadDirectory(fileInfo.absolutePath());
                m_pendingDownload->setDownloadFileName(fileInfo.fileName());
                qInfo() << "[Symmetria] Download saved:"
                        << m_pendingDownload->downloadFileName()
                        << "→" << m_pendingDownload->downloadDirectory();
                m_pendingDownload->resume();
                m_pendingDownload->accept();
            } else {
                qInfo() << "[Symmetria] Download cancelled (empty URI list)";
                m_pendingDownload->resume();
                m_pendingDownload->cancel();
            }
        } else {
            qInfo() << "[Symmetria] Download cancelled by user";
            m_pendingDownload->resume();
            m_pendingDownload->cancel();
        }

        m_pendingDownload = nullptr;
    }

private:
    QQuickWebEngineDownloadRequest *m_pendingDownload = nullptr;
};

#endif // DOWNLOADHANDLER_H
