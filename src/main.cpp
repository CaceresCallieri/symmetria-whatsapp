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

    // setDesktopFileName controls the Wayland app_id so compositors can match
    // this window to the .desktop entry for taskbar grouping and icon lookup.
    app.setDesktopFileName("symmetria-whatsapp");

    // Build a multi-resolution icon so the platform can pick the best size for
    // each context (title bar, alt-tab, taskbar). Falls back to the XDG icon
    // theme at runtime; this covers in-process uses (e.g. QFileDialog title).
    QIcon windowIcon;
    windowIcon.addFile(":/icons/whatsapp-16x16.png",   QSize(16,   16));
    windowIcon.addFile(":/icons/whatsapp-32x32.png",   QSize(32,   32));
    windowIcon.addFile(":/icons/whatsapp-128x128.png", QSize(128, 128));
    windowIcon.addFile(":/icons/whatsapp-256x256.png", QSize(256, 256));
    windowIcon.addFile(":/icons/whatsapp-512x512.png", QSize(512, 512));
    app.setWindowIcon(windowIcon);

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
