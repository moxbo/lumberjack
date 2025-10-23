# lumberjack

A fast, lightweight Electron-based log file viewer with advanced filtering capabilities.

## Performance

Lumberjack is optimized for near-instant startup:
- **Bundle size**: 81KB (gzipped: 26KB)
- **Startup time**: < 2 seconds (cold start on typical hardware)
- **Memory efficient**: Lazy-loads features only when needed

See [PERFORMANCE.md](PERFORMANCE.md) for details on optimizations implemented.

## Features

- Message-Filter: & = UND, | = ODER, ! = NICHT (Negation)
  - Case-insensitive Teilstring-Suche
  - Beispiele:
    - `error|warn` → Zeigt Nachrichten, die „error“ ODER „warn“ enthalten
    - `service&timeout` → Zeigt Nachrichten, die „service“ UND „timeout“ enthalten
    - `QcStatus&!CB23` → Zeigt Nachrichten, die „QcStatus“ enthalten, aber NICHT „CB23“
    - `!!foo` → Doppelte Negation entspricht normal: „foo“

## Datei-Logging

- Aktivierung: In der App unter „Einstellungen…“ den Schalter „In Datei schreiben“ aktivieren.
- Ziel: Standardmäßig wird unter dem App-Datenordner (portable: `data/`) die Datei `lumberjack.log` geschrieben. Ein benutzerdefinierter Pfad kann über „Wählen…“ gesetzt werden.
- Format: JSON-Lines (eine Zeile pro Eintrag), identisch zur internen Event-Struktur.
- Rotation: Konfigurierbar über maximale Größe (MB) und Anzahl Backups. Beim Überschreiten wird rotiert: `lumberjack.log` → `lumberjack.log.1`, usw.
- Quellen: Alle eingehenden Einträge (Datei-Parsing, HTTP-Load/Poll, TCP) werden bei aktiver Option fortlaufend in die Logdatei geschrieben.
