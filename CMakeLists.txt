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

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)

target_link_libraries(${PROJECT_NAME} PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::WebEngineQuick
)
