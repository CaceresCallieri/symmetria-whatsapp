#ifndef PROFILESETUP_H
#define PROFILESETUP_H

#include <QObject>
#include <QQmlEngine>
#include <QStandardPaths>
#include <QtWebEngineQuick/qquickwebengineprofile.h>
#include <QWebEngineScript>
#include <QCoreApplication>
#include "DownloadHandler.h"

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
    }

    QQuickWebEngineProfile *personalProfile() const { return m_personalProfile; }
    QQuickWebEngineProfile *workProfile() const { return m_workProfile; }

private:
    static constexpr auto k_userAgent =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

    QQuickWebEngineProfile *m_personalProfile;
    QQuickWebEngineProfile *m_workProfile;
    DownloadHandler *m_downloadHandler;

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
        // (e.g. ~/Downloads). The actual save path is chosen by the user via
        // a FileDialog in QML — this just sets the dialog's initial folder.
        profile->setDownloadPath(
            QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));

        // Install storage persistence override script.
        // QWebEngineScript with DocumentCreation injection point runs before
        // WhatsApp's JS, so navigator.storage.persist() returns true and
        // IndexedDB session keys won't be evicted.
        installStorageScript(profile);

        qInfo() << "[Symmetria] Profile created:" << storageName
                << "storage:" << profile->persistentStoragePath()
                << "cache:" << profile->cachePath();

        return profile;
    }

    static void installStorageScript(QQuickWebEngineProfile *profile)
    {
        // QQuickWebEngineScriptCollection is a private Qt type (forward-declared
        // only in the public header). Access it via the userScripts Q_PROPERTY
        // as QVariant → QObject*, then dispatch insert() via QMetaObject since
        // insert() is Q_INVOKABLE on the private type. This is the documented
        // workaround for accessing private-API collections from C++ code that
        // cannot include Qt private headers.
        QVariant v = profile->property("userScripts");
        QObject *scripts = qvariant_cast<QObject *>(v);

        if (!scripts) {
            qWarning() << "[Symmetria] Could not get userScripts from profile";
            return;
        }

        QWebEngineScript script;
        script.setName(QStringLiteral("symmetria-storage-persist"));
        script.setSourceCode(QStringLiteral(
            "if (navigator.storage) {"
            "  navigator.storage.persist = () => Promise.resolve(true);"
            "  navigator.storage.persisted = () => Promise.resolve(true);"
            "}"
        ));
        script.setInjectionPoint(QWebEngineScript::DocumentCreation);
        script.setWorldId(QWebEngineScript::MainWorld);
        script.setRunsOnSubFrames(false);

        QMetaObject::invokeMethod(scripts, "insert",
                                  Q_ARG(QWebEngineScript, script));
    }
};

#endif // PROFILESETUP_H
