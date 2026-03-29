#ifndef PROFILESETUP_H
#define PROFILESETUP_H

#include <QObject>
#include <QQmlEngine>
#include <QStandardPaths>
#include <QtWebEngineQuick/qquickwebengineprofile.h>
#include <QWebEngineScript>

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
        , m_personalProfile(nullptr)
        , m_workProfile(nullptr)
    {
        const QString userAgent =
            QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36");

        m_personalProfile = createProfile(QStringLiteral("personal"), userAgent);
        m_workProfile = createProfile(QStringLiteral("work"), userAgent);
    }

    QQuickWebEngineProfile *personalProfile() const { return m_personalProfile; }
    QQuickWebEngineProfile *workProfile() const { return m_workProfile; }

private:
    QQuickWebEngineProfile *m_personalProfile;
    QQuickWebEngineProfile *m_workProfile;

    QQuickWebEngineProfile *createProfile(const QString &storageName,
                                          const QString &userAgent)
    {
        // Using the constructor that takes storageName ensures the browser
        // context is created as persistent from the very start.
        auto *profile = new QQuickWebEngineProfile(storageName, this);

        profile->setHttpUserAgent(userAgent);
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

    void installStorageScript(QQuickWebEngineProfile *profile)
    {
        // Access userScripts as a Q_PROPERTY, then call insert() via
        // QMetaObject since the script collection type is private API.
        QVariant v = profile->property("userScripts");
        QObject *scripts = qvariant_cast<QObject*>(v);

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
