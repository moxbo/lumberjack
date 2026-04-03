# Security Policy

Thank you for helping keep Lumberjack and our users safe!

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Lumberjack seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please send an email to the maintainer or create a private security advisory through GitHub:

1. Go to the repository's **Security** tab
2. Click **Report a vulnerability**
3. Provide a detailed description of the vulnerability

### What to Include

- Type of vulnerability (e.g., buffer overflow, SQL injection, cross-site scripting)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the vulnerability, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution**: Typically within 30-90 days, depending on complexity

### What to Expect

- We will acknowledge receipt of your vulnerability report
- We will send you regular updates about our progress
- If you have followed the instructions above, we will not take any legal action against you regarding the report
- We will handle your report with strict confidentiality and not share your personal information without permission

### Disclosure Policy

- We will work with you to understand and resolve the issue quickly
- We follow a coordinated disclosure policy
- We will credit you (if desired) in any public disclosure

## Application Security

### Log File Handling

- Lumberjack processes log files locally and does not transmit data externally
- Be aware that log files may contain sensitive information
- All log parsing and filtering occurs in-process on the user's device

### Security Best Practices for Users

- Keep the application updated to the latest version
- Verify checksums of downloaded files when available
- Download Lumberjack only from official sources (GitHub Releases)

## Dependencies

- We regularly update dependencies to address known vulnerabilities
- You can check the current dependency status in our `package.json`
- Review third-party licenses in `docs/THIRD_PARTY_LICENSES.md`
- See our [Privacy Policy](docs/PRIVACY.md) for more information

---

## Security Addendum: Telemetry & Data Handling

**Status**: Lumberjack enthält **keine Telemetrie** und sendet **keine Nutzungsdaten**.

### Klarstellung

| Kategorie | Status | Details |
|-----------|--------|---------|
| Telemetrie / Analytics | ❌ Nicht vorhanden | Keine Nutzungs-, Crash- oder Performance-Daten werden gesendet |
| Netzwerkverkehr (ausgehend) | ⚠️ Nur Auto-Update | Optional: Prüfung auf GitHub Releases (`electron-updater`) |
| Netzwerkverkehr (eingehend) | ⚠️ Nur TCP Listener | Optional: Empfang von Log-Daten über lokales Netzwerk |
| Lokale Daten | ✅ Nur lokal | Einstellungen, Logs und Cache verbleiben auf dem Gerät |
| Drittanbieter-Dienste | ❌ Keine | Keine externen APIs, kein Tracking, keine Werbung |

### Auto-Update (optional)

- Lumberjack nutzt `electron-updater` um auf GitHub Releases nach Updates zu suchen
- Dabei wird eine HTTPS-Anfrage an `api.github.com` gestellt
- Es werden **keine** personenbezogenen Daten, Geräte-IDs oder Nutzungsstatistiken übertragen
- Der Update-Check kann vom Benutzer deaktiviert werden

### TCP Log Listener (optional)

- Wenn aktiviert, öffnet Lumberjack einen TCP-Port zum Empfang von Log-Daten
- Dieser Port ist nur im lokalen Netzwerk erreichbar
- Es werden keine Daten nach außen gesendet

### Falls Telemetrie zukünftig eingeführt wird

Sollte in einer zukünftigen Version Telemetrie hinzugefügt werden, gelten folgende Grundsätze:

1. **Opt-In only**: Telemetrie wird nur mit expliziter Zustimmung aktiviert
2. **Minimal & anonym**: Nur aggregierte, nicht-personenbezogene Metriken
3. **Transparenz**: Vollständige Dokumentation in PRIVACY.md und Release Notes
4. **DSGVO-Konformität**: Einhaltung aller datenschutzrechtlichen Anforderungen
5. **Deaktivierbar**: Jederzeit durch den Benutzer abschaltbar

> Weitere Informationen: [Privacy Policy](docs/PRIVACY.md)


