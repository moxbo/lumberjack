# 🚀 Erste Schritte mit Lumberjack

Willkommen! Diese Seite führt dich in unter **5 Minuten** durch die wichtigsten
Funktionen von Lumberjack.

---

## 📦 Installation

Siehe Hauptseite: [../../README.md#-quick-start](../../README.md#-quick-start)
für die plattformspezifischen Schritte (Homebrew, DMG, Portable, Setup, AppImage).

---

## 🪵 Logs in Lumberjack laden

Du hast mehrere Wege, Logs zu sehen:

1. **Datei öffnen** – `Datei → Datei öffnen…` (oder `Ctrl/Cmd+O`)
2. **TCP-Streaming** – Konfiguriere deine App so, dass sie Logs an
   `localhost:4445` sendet. Beispiel-Konfigurationen für Logback / Log4j2 /
   Log4j 1.x findest du in der
   [Haupt-README](../../README.md#-tcp-log-streaming-configuration).
3. **HTTP-Tailing** – `Datei → HTTP URL tailen…`, ideal für Spring Boot
   Actuator (`/actuator/logfile`). Nur neue Bytes werden per
   `Range`-Request übertragen.
4. **Datei-Tail** – `Datei → Datei tailen…` für lokale Log-Dateien mit
   Live-Updates (inklusive Rotation).
5. **Elasticsearch** – Über die Elasticsearch-Suchmaske gezielt Indizes
   abfragen.

---

## 🔎 Filtern

Lumberjack hat eine Mini-Filter-Sprache:

| Operator | Bedeutung | Beispiel          |
|----------|-----------|-------------------|
| `&`      | UND       | `service&timeout` |
| `\|`     | ODER      | `error\|warn`     |
| `!`      | NICHT     | `QcStatus&!CB23`  |

**Filter-Profile** (`Filter → Profile`):

- Speichern, Suchen, Import/Export
- Undo nach versehentlichem Überschreiben

**MDC-/Diagnostic-Context-Filter:** Klicke auf einen MDC-Schlüssel in einer
Zeile, um nach diesem Wert zu filtern.

---

## 🔖 Bookmarks

- Eintrag markieren: `Ctrl/Cmd+D` oder Kontextmenü → *Bookmark*
- Übersicht: Bookmark-Popover in der Toolbar
- Bookmarks bleiben über Filteränderungen erhalten

---

## 🔔 Alert-Regeln

Unter `Einstellungen → Alerts` kannst du Regeln definieren (Level, Text, MDC),
die bei passenden Log-Einträgen eine native OS-Notification auslösen.

---

## 🌍 Sprache umschalten

`Einstellungen → Sprache` – Deutsch oder Englisch. Sowohl die Renderer-UI als
auch das Electron-Menü werden umgestellt.

---

## ⌨️ Wichtige Shortcuts

| Aktion                   | Shortcut                           |
|--------------------------|------------------------------------|
| Datei öffnen             | `Ctrl/Cmd+O`                       |
| Suchen                   | `Ctrl/Cmd+F`                       |
| Bookmark setzen          | `Ctrl/Cmd+D`                       |
| Nächster/Voriger Treffer | `F3` / `Shift+F3`                  |
| Auswahl löschen          | `Esc`                              |
| Listennavigation         | `↑` `↓` `Home` `End` `PgUp` `PgDn` |

---

## 🆘 Probleme?

→ [TROUBLESHOOTING_AND_FAQ.md](TROUBLESHOOTING_AND_FAQ.md)

→ Logs der App findest du unter:

| OS      | Pfad                                 |
|---------|--------------------------------------|
| Windows | `%APPDATA%\Lumberjack\logs\main.log` |
| macOS   | `~/Library/Logs/Lumberjack/main.log` |
| Linux   | `~/.config/Lumberjack/logs/main.log` |

