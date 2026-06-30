#ifndef WHATSAPPBRIDGE_H
#define WHATSAPPBRIDGE_H

#include <QObject>
#include <QQmlEngine>
#include <QVariantList>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonParseError>
#include <QDebug>

// HYBRID architecture bridge (PRD Phase 2 spike).
//
// This is the data-OUT half of the hybrid model: a minimal QObject published to
// the embedded WhatsApp Web page over QWebChannel. The page-side bridge script
// (src/js/whatsapp-bridge.js) scrapes a *small, targeted* slice of WhatsApp Web
// (the chat list) and pushes it here; this object re-exposes it to the native
// QML UI as a reactive `chats` property.
//
// IMPORTANT — this is NOT the abandoned keyboard-nav injection. That injected
// script faked navigation inside WhatsApp's own UI (brittle, fought the
// platform). This reads a minimal data surface into a UI WE own. Keeping the
// read surface small is the deliberate change-resilience strategy (see
// CLAUDE.md / PRD Phase 2). Each chat is a {title, unread} map.
class WhatsAppBridge : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QVariantList chats READ chats NOTIFY chatsChanged)

public:
    explicit WhatsAppBridge(QObject *parent = nullptr)
        : QObject(parent)
    {
    }

    QVariantList chats() const { return m_chats; }

public slots:
    // Invoked from the page's JavaScript over QWebChannel. `chatsJson` is a JSON
    // array of {title, unread} objects scraped from the WhatsApp Web chat list.
    // Marked as a slot so QWebChannel exposes it as a callable method to JS.
    void receiveChats(const QString &chatsJson)
    {
        QJsonParseError err;
        const QJsonDocument doc = QJsonDocument::fromJson(chatsJson.toUtf8(), &err);
        if (err.error != QJsonParseError::NoError || !doc.isArray()) {
            qWarning() << "[Symmetria] Bridge: invalid chats JSON —"
                       << err.errorString();
            return;
        }

        QVariantList parsed;
        const QJsonArray arr = doc.array();
        parsed.reserve(arr.size());
        for (const QJsonValue &v : arr)
            parsed.append(v.toObject().toVariantMap());

        // No-op if the chat list is unchanged — avoids redundant QML updates
        // when the page-side MutationObserver fires on unrelated DOM churn.
        if (parsed == m_chats)
            return;

        m_chats = parsed;
        qInfo() << "[Symmetria] Bridge: received" << m_chats.size() << "chats";
        emit chatsChanged();
    }

signals:
    void chatsChanged();

private:
    QVariantList m_chats;
};

#endif // WHATSAPPBRIDGE_H
