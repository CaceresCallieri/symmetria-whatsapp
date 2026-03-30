#include <QGuiApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QStyleHints>
#include <QtWebEngineQuick/qtwebenginequickglobal.h>
#include "ProfileSetup.h"

int main(int argc, char *argv[])
{
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    qputenv("QML_XHR_ALLOW_FILE_READ", "1");
    QtWebEngineQuick::initialize();

    QGuiApplication app(argc, argv);
    app.setApplicationName("symmetria-whatsapp");
    app.setOrganizationName("Symmetria");
    app.setApplicationVersion("0.1.0");
    app.setDesktopFileName("symmetria-whatsapp");
    app.setWindowIcon(QIcon(":/icons/whatsapp-256x256.png"));

    // Force dark color scheme so Chromium reports prefers-color-scheme: dark
    // to web content. WhatsApp Web's "System Default" theme reads this and
    // activates its native dark mode.
    app.styleHints()->setColorScheme(Qt::ColorScheme::Dark);

    QQmlApplicationEngine engine;

    QObject::connect(
        &engine, &QQmlApplicationEngine::objectCreationFailed,
        &app, []() { QCoreApplication::exit(1); },
        Qt::QueuedConnection
    );

    engine.loadFromModule("com.symmetria.whatsapp", "Main");

    return app.exec();
}
