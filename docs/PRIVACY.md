# Datenschutzerklärung / Privacy Policy

**Anwendung**: Lumberjack  
**Version**: 1.0.2  
**Stand**: Dezember 2025

---

## Deutsch

### Überblick

Lumberjack ist eine Desktop-Anwendung zur Anzeige und Filterung von Log-Dateien. Die Anwendung wurde mit Fokus auf Datenschutz entwickelt und sammelt **keine** personenbezogenen Daten.

### Datenerhebung

**Lumberjack sammelt, speichert oder überträgt keine:**

- Personenbezogenen Daten
- Nutzungsstatistiken oder Telemetrie
- Analysedaten
- Standortdaten
- Geräteinformationen

### Lokale Datenverarbeitung

Alle Daten werden ausschließlich lokal auf Ihrem Gerät verarbeitet:

| Datentyp | Speicherort | Zweck |
|----------|-------------|-------|
| Geöffnete Log-Dateien | Im Arbeitsspeicher | Anzeige und Filterung |
| Anwendungseinstellungen | Lokaler App-Ordner | Benutzereinstellungen speichern |
| Anwendungslogs | Lokaler App-Ordner | Fehlerdiagnose |

**Speicherorte der Anwendungsdaten:**
- **Windows**: `%APPDATA%\lumberjack\`
- **macOS**: `~/Library/Application Support/lumberjack/`
- **Linux**: `~/.config/lumberjack/`

### Netzwerkverbindungen

Lumberjack stellt nur in folgenden Fällen Netzwerkverbindungen her:

1. **TCP Log-Empfang** (optional): Wenn Sie die TCP-Listener-Funktion aktivieren, empfängt die Anwendung Log-Daten über das lokale Netzwerk. Diese Verbindungen werden nur auf Ihre explizite Anforderung hergestellt.

2. **Auto-Update** (optional): Die Anwendung kann auf GitHub prüfen, ob Updates verfügbar sind. Dabei werden keine personenbezogenen Daten übertragen.

### Drittanbieter-Dienste

Lumberjack verwendet keine Drittanbieter-Dienste, die Daten erheben. Eine vollständige Liste der verwendeten Open-Source-Bibliotheken finden Sie in [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

### Ihre Rechte

Da keine personenbezogenen Daten erhoben werden, entfallen die üblichen Betroffenenrechte nach DSGVO (Auskunft, Löschung, etc.). Sie können jederzeit:

- Alle lokalen Anwendungsdaten manuell löschen
- Die Anwendung vollständig deinstallieren
- Die Netzwerkfunktionen deaktiviert lassen

### Änderungen

Diese Datenschutzerklärung kann bei neuen Versionen aktualisiert werden. Wesentliche Änderungen werden in den Release Notes dokumentiert.

---

## English

### Overview

Lumberjack is a desktop application for viewing and filtering log files. The application was designed with privacy in mind and collects **no** personal data.

### Data Collection

**Lumberjack does not collect, store, or transmit:**

- Personal data
- Usage statistics or telemetry
- Analytics data
- Location data
- Device information

### Local Data Processing

All data is processed exclusively on your local device:

| Data Type | Location | Purpose |
|-----------|----------|---------|
| Opened log files | In memory | Display and filtering |
| Application settings | Local app folder | Store user preferences |
| Application logs | Local app folder | Error diagnosis |

**Application data locations:**
- **Windows**: `%APPDATA%\lumberjack\`
- **macOS**: `~/Library/Application Support/lumberjack/`
- **Linux**: `~/.config/lumberjack/`

### Network Connections

Lumberjack only establishes network connections in the following cases:

1. **TCP Log Receiver** (optional): When you enable the TCP listener feature, the application receives log data over the local network. These connections are only established at your explicit request.

2. **Auto-Update** (optional): The application may check GitHub for available updates. No personal data is transmitted during this process.

### Third-Party Services

Lumberjack does not use any third-party services that collect data. A complete list of open-source libraries used can be found in [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

### Your Rights

Since no personal data is collected, the usual data subject rights under GDPR (access, deletion, etc.) do not apply. You can at any time:

- Manually delete all local application data
- Completely uninstall the application
- Keep network features disabled

### Changes

This privacy policy may be updated with new versions. Significant changes will be documented in the release notes.

---

## Kontakt / Contact

Bei Fragen zum Datenschutz / For privacy questions:

- **Repository**: [GitHub Issues](https://github.com/your-org/lumberjack/issues)
- **E-Mail**: [Ihre Kontakt-E-Mail hier einfügen]

---

*Diese Datenschutzerklärung gilt für Lumberjack Version 1.0.0 und höher.*

*This privacy policy applies to Lumberjack version 1.0.0 and later.*

