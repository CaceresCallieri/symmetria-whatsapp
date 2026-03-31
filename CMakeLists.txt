cmake_minimum_required(VERSION 3.21)

project(symmetria-whatsapp
    VERSION 0.1.0
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS
    Core
    Gui
    Qml
    Quick
    WebEngineQuick
    DBus
)

qt_standard_project_setup(REQUIRES 6.5)

qt_add_executable(${PROJECT_NAME}
    src/main.cpp
)

qt_add_qml_module(${PROJECT_NAME}
    URI com.symmetria.whatsapp
    VERSION 1.0
    SOURCES
        src/ProfileSetup.h
        src/DownloadHandler.h
    QML_FILES
        src/qml/Main.qml
        src/qml/AccountSidebar.qml
        src/qml/AccountView.qml
)

# Bundle JS and JSON as resources with clean paths
qt_add_resources(${PROJECT_NAME} "js"
    PREFIX "/"
    BASE "src/js"
    FILES
        src/js/keyboard-nav.js
)

qt_add_resources(${PROJECT_NAME} "selectors"
    PREFIX "/"
    BASE "resources"
    FILES
        resources/selectors.json
)

# Bundle app icons as Qt resources under the ":/icons/" prefix.
# 1024x1024 is intentionally excluded — it bloats the binary (~446 KB) with no
# benefit at runtime; compositors use the XDG icon theme install below instead.
qt_add_resources(${PROJECT_NAME} "icons"
    PREFIX "/icons"
    BASE "resources/icons"
    FILES
        resources/icons/whatsapp-16x16.png
        resources/icons/whatsapp-32x32.png
        resources/icons/whatsapp-128x128.png
        resources/icons/whatsapp-256x256.png
        resources/icons/whatsapp-512x512.png
)

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)

target_link_libraries(${PROJECT_NAME} PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::WebEngineQuick
    Qt6::DBus
)

# Install app icons into the XDG hicolor icon theme so the .desktop entry
# (Icon=symmetria-whatsapp) resolves correctly in app launchers and taskbars.
install(FILES resources/icons/whatsapp-16x16.png
    DESTINATION share/icons/hicolor/16x16/apps
    RENAME symmetria-whatsapp.png
)
install(FILES resources/icons/whatsapp-32x32.png
    DESTINATION share/icons/hicolor/32x32/apps
    RENAME symmetria-whatsapp.png
)
install(FILES resources/icons/whatsapp-128x128.png
    DESTINATION share/icons/hicolor/128x128/apps
    RENAME symmetria-whatsapp.png
)
install(FILES resources/icons/whatsapp-256x256.png
    DESTINATION share/icons/hicolor/256x256/apps
    RENAME symmetria-whatsapp.png
)
install(FILES resources/icons/whatsapp-512x512.png
    DESTINATION share/icons/hicolor/512x512/apps
    RENAME symmetria-whatsapp.png
)
install(FILES resources/icons/whatsapp-1024x1024.png
    DESTINATION share/icons/hicolor/1024x1024/apps
    RENAME symmetria-whatsapp.png
)
