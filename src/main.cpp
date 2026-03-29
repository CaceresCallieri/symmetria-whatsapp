#include <QGuiApplication>
#include <QQmlApplicationEngine>
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

    QQmlApplicationEngine engine;

    QObject::connect(
        &engine, &QQmlApplicationEngine::objectCreationFailed,
        &app, []() { QCoreApplication::exit(1); },
        Qt::QueuedConnection
    );

    engine.loadFromModule("com.symmetria.whatsapp", "Main");

    return app.exec();
}
