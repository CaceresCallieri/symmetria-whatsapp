#ifndef PROFILESETUP_H
#define PROFILESETUP_H

#include <QObject>
#include <QQmlEngine>
#include <QStandardPaths>
#include <QtWebEngineQuick/qquickwebengineprofile.h>
#include <QWebEngineScript>
#include <QWebEnginePermission>
#include <QCoreApplication>
#include "DownloadHandler.h"
#include "NotificationHandler.h"

// Creates and manages persistent WebEngine profiles from C++.
//
// QML's WebEngineProfile has a timing issue on Qt 6.9+: the browser
// context is created during construction, before QML property bindings
// (storageName, persistentCookiesPolicy) are applied. This means the
// profile starts off-the-record and never transitions to persistent.
//
// The fix (used by Whatsie, ZapZap, and other mature wrappers): create
// profiles in C++ using the constructor that takes storageName, which
// sets it at construction time before the browser context is created.
//
// DEPENDENCY: QCoreApplication::setApplicationName() and setOrganizationName()
// must be called before this singleton is first instantiated. ProfileSetup is
// accessed from QML after the engine loads, which happens after main() sets
// these values, so the ordering is safe. Do not move profile construction to
// before QGuiApplication is fully configured.
class ProfileSetup : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QQuickWebEngineProfile* personalProfile READ personalProfile CONSTANT)
    Q_PROPERTY(QQuickWebEngineProfile* workProfile READ workProfile CONSTANT)

public:
    explicit ProfileSetup(QObject *parent = nullptr)
        : QObject(parent)
    {
        m_personalProfile = createProfile(QStringLiteral("personal"));
        m_workProfile = createProfile(QStringLiteral("work"));

        m_downloadHandler = new DownloadHandler(this);
        m_downloadHandler->attachToProfile(m_personalProfile);
        m_downloadHandler->attachToProfile(m_workProfile);

        m_notificationHandler = new NotificationHandler(this);
        m_notificationHandler->attachToProfile(m_personalProfile,
                                               QStringLiteral("Personal"));
        m_notificationHandler->attachToProfile(m_workProfile,
                                               QStringLiteral("Work"));

        // Relay notification clicks to QML for account switching.
        connect(m_notificationHandler, &NotificationHandler::notificationClicked,
                this, &ProfileSetup::notificationClicked);
    }

    QQuickWebEngineProfile *personalProfile() const { return m_personalProfile; }
    QQuickWebEngineProfile *workProfile() const { return m_workProfile; }

signals:
    // Forwarded from NotificationHandler — emitted when the user clicks a
    // notification in the system notification center. accountName is "Personal" or "Work".
    void notificationClicked(const QString &accountName);

private:
    static constexpr auto k_userAgent =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

    QQuickWebEngineProfile *m_personalProfile;
    QQuickWebEngineProfile *m_workProfile;
    DownloadHandler *m_downloadHandler;
    NotificationHandler *m_notificationHandler;

    QQuickWebEngineProfile *createProfile(const QString &storageName)
    {
        // Guard against misconfigured startup order: storage paths derived
        // from QStandardPaths::AppDataLocation embed the application name.
        // If applicationName is empty the paths collapse to a generic location
        // and multiple apps could share storage.
        Q_ASSERT_X(!QCoreApplication::applicationName().isEmpty(),
                   "ProfileSetup::createProfile",
                   "applicationName must be set before profiles are created");

        // Using the constructor that takes storageName ensures the browser
        // context is created as persistent from the very start.
        auto *profile = new QQuickWebEngineProfile(storageName, this);

        profile->setHttpUserAgent(QLatin1StringView(k_userAgent));
        profile->setPersistentCookiesPolicy(
            QQuickWebEngineProfile::AllowPersistentCookies);
        profile->setHttpCacheType(
            QQuickWebEngineProfile::DiskHttpCache);

        // Set explicit storage paths (matches Whatsie's approach).
        const QString dataPath =
            QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
        const QString cachePath =
            QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
        profile->setPersistentStoragePath(dataPath + "/" + storageName);
        profile->setCachePath(cachePath + "/" + storageName);

        // Set default download directory to the system Downloads folder
        // (e.g. ~/Downloads). DownloadHandler presents a native Save As dialog
        // via the XDG Desktop Portal; this just sets the portal's initial folder.
        profile->setDownloadPath(
            QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));

        // Pre-grant notification permission at the Chromium level so
        // new Notification() calls from WhatsApp Web are not silently
        // dropped. This uses Qt 6.8+'s QWebEnginePermission API to set
        // the permission in Chromium's store before the page loads.
        auto perm = profile->queryPermission(
            QUrl(QStringLiteral("https://web.whatsapp.com")),
            QWebEnginePermission::PermissionType::Notifications);
        if (perm.isValid())
            perm.grant();
        else
            qWarning() << "[Symmetria] queryPermission returned invalid for"
                       << storageName
                       << "— notifications may not work (requires Qt 6.8+)";

        // Install early-injection scripts that patch browser APIs before
        // WhatsApp's JS runs. DocumentCreation injection point guarantees
        // these execute before any page scripts.
        installScript(profile,
                      QStringLiteral("symmetria-storage-persist"),
                      QStringLiteral(
                          "if (navigator.storage) {"
                          "  navigator.storage.persist = () => Promise.resolve(true);"
                          "  navigator.storage.persisted = () => Promise.resolve(true);"
                          "}"
                      ));

        // WhatsApp Web checks Notification.permission synchronously on page load.
        // In Qt WebEngine this returns "default" until an explicit permission
        // request is granted, so WhatsApp never creates any Notification objects
        // — it shows a "click the bell icon" dialog instead.
        //
        // Override the JS permission getter so WhatsApp sees "granted" and
        // skips its "enable notifications" dialog. The Chromium-level grant is
        // handled separately by queryPermission/perm.grant() above and by
        // onPermissionRequested in AccountView.qml.
        //
        // We must NOT replace Notification.requestPermission — if we intercept
        // it, the Chromium permission is never set and new Notification() calls
        // are silently dropped even though the JS property says "granted".
        installScript(profile,
                      QStringLiteral("symmetria-notification-permission"),
                      QStringLiteral(
                          "if (window.Notification) {"
                          "  Object.defineProperty(Notification, 'permission', {"
                          "    get: function() { return 'granted'; }"
                          "  });"
                          "}"
                      ));

        qInfo() << "[Symmetria] Profile created:" << storageName
                << "storage:" << profile->persistentStoragePath()
                << "cache:" << profile->cachePath();

        return profile;
    }

    // Installs a DocumentCreation user script into the given profile's MainWorld.
    // Both scripts that patch browser APIs (storage persistence and notification
    // permission) share this boilerplate — only the name and source differ.
    //
    // QQuickWebEngineScriptCollection is a private Qt type (forward-declared
    // only in the public header). Access it via the userScripts Q_PROPERTY
    // as QVariant → QObject*, then dispatch insert() via QMetaObject since
    // insert() is Q_INVOKABLE on the private type. This is the documented
    // workaround for accessing private-API collections from C++ code that
    // cannot include Qt private headers.
    static void installScript(QQuickWebEngineProfile *profile,
                              const QString &name,
                              const QString &sourceCode)
    {
        QVariant v = profile->property("userScripts");
        QObject *scripts = qvariant_cast<QObject *>(v);

        if (!scripts) {
            qWarning() << "[Symmetria] Could not get userScripts for script:" << name;
            return;
        }

        QWebEngineScript script;
        script.setName(name);
        script.setSourceCode(sourceCode);
        script.setInjectionPoint(QWebEngineScript::DocumentCreation);
        script.setWorldId(QWebEngineScript::MainWorld);
        script.setRunsOnSubFrames(false);

        QMetaObject::invokeMethod(scripts, "insert",
                                  Q_ARG(QWebEngineScript, script));
    }
};

#endif // PROFILESETUP_H
