# Lumberjack

Ein schneller, schlanker Electron-basierter Log-Viewer mit leistungsfähigen Filtern.

## Inhalte

- Überblick & Features
- Entwicklung & Start
- Build & Artefakte (Windows)
- App-Icon (Windows): EXE-Icon und Laufzeit-Icon
- Icon erzeugen (Multi-Size ICO)
- Troubleshooting: Wenn trotzdem das Standard-Icon erscheint
- Performance
- Troubleshooting & Diagnostik
- Architektur-Entscheidungen (siehe docs/ARCHITECTURE_DECISION.md)
- Copilot-Agent Leitfaden (siehe docs/COPILOT_AGENT.md)

## Überblick & Features

- Message-Filter: `&` = UND, `|` = ODER, `!` = NICHT (Negation)
  - Case-insensitive Teilstring-Suche
  - Beispiele:
    - `error|warn` → Nachrichten mit „error“ ODER „warn“
    - `service&timeout` → Nachrichten mit „service“ UND „timeout“
    - `QcStatus&!CB23` → „QcStatus“, aber NICHT „CB23“
    - `!!foo` → doppelte Negation entspricht normal „foo“

## Entwicklung & Start

Voraussetzungen: Node.js LTS, npm

Windows (cmd):

```cmd
npm install
npm run dev
```

Hinweise:

- Der Dev-Start läuft als `electron.exe`. In der Windows-Taskleiste erscheint dabei typischerweise das Electron-Icon (nicht das App-Icon). Das ist normal und kein Fehler.

## Build & Artefakte (Windows)

Es wird mit electron-builder gebaut. Die Artefakte liegen unter `release/`.

- Schnellstart (ZIP x64):

```cmd
npm run build:zip:x64
```

- Portable (ohne Installer):

```cmd
npm run build:portable:x64
```

- Start der gepackten App (für verlässlichen Icon-Check):

```cmd
.\release\win-unpacked\Lumberjack.exe
```

## App-Icon (Windows): EXE-Icon und Laufzeit-Icon

Es gibt zwei unterschiedliche Icons:

1. EXE-Icon (Datei-/Explorer-/Installer-Icon)

- Wird beim Build in die `Lumberjack.exe` eingebettet.
- Konfiguration (aus `package.json` → `build`):
  - `directories.buildResources: "images"`
  - `win.icon: "icon.ico"` (relativ zu `buildResources`)
- Erwartetes Layout in diesem Repo:
  - `images/icon.ico` (Multi-Size ICO)

2. Laufzeit-Icon (Fenster-/Taskleisten-Icon zur Laufzeit)

- Wird in `main.js` beim Erzeugen des `BrowserWindow` gesetzt.
- Wichtig: Pfad muss eine echte Datei sein (nicht nur aus `app.asar`). In dieser App:
  - Es wird zuerst `resources/app.asar.unpacked/images/icon.ico` genutzt (falls vorhanden),
  - oder `resources/images/icon.ico`,
  - oder – wenn nur in `app.asar` vorhanden – zur Laufzeit nach `%AppData%/Lumberjack/assets/app-icon.ico` extrahiert und dieser Pfad verwendet.
- Beim Start steht in der Konsole: `App-Icon verwendet: <Pfad>`.

AUMID/Gruppierung:

- `app.setAppUserModelId('de.hhla.lumberjack')` ist gesetzt und entspricht `build.appId`. Das ist wichtig für die Taskleisten-Gruppierung und ein konsistentes Icon-Verhalten.

## Icon erzeugen (Multi-Size ICO)

Windows erwartet ein „vollwertiges“ Icon mit mehreren Größen (z. B. 16, 32, 48, 64, 128, 256 px). In diesem Repo gibt es ein Skript, das eine Multi-Size-ICO aus einer PNG generiert:

Quelle (Beispiel):

- `images/lumberjack_v4_normal_1024.png` (oder `..._dark_1024.png`)

ICO erzeugen:

```cmd
npm run icon:generate
```

Ergebnis:

- `images/icon.ico` wird neu erstellt (mehrere Größen enthalten).

Danach neu bauen:

```cmd
npm run build:zip:x64
```

## Troubleshooting: Wenn trotzdem das Standard-Icon erscheint

Wenn die EXE im Explorer oder in der Taskleiste weiterhin das Electron-Icon zeigt, prüfe Folgendes:

1. Prüfe die gepackte EXE im Explorer

- Rechtsklick auf `release\win-unpacked\Lumberjack.exe` → Eigenschaften.
- Wird hier dein Icon angezeigt? Wenn ja: EXE-Icon ist korrekt eingebettet.

2. Taskleisten-Pins und Icon-Cache

- Entferne alte angepinnte Verknüpfungen (Taskleiste/Start) der App, dann erst die neue EXE anpinnen.
- Optional: Version in `package.json` erhöhen (z. B. `1.0.1` → `1.0.2`) und neu bauen – Windows bewertet Icons dann eher neu, da sich Dateinamen ändern.

3. Laufzeit-Icon-Pfad prüfen

- Starte die gepackte EXE aus `release\win-unpacked` und beobachte die Konsole.
- Es sollte eine Zeile erscheinen: `App-Icon verwendet: <Pfad>`.
  - Erwartet ist ein Pfad außerhalb des ASAR, z. B. `...\resources\app.asar.unpacked\images\icon.ico` oder `%AppData%\Lumberjack\assets\app-icon.ico`.
  - Falls der Pfad in `app.asar\images\icon.ico` liegt, wird automatisch extrahiert und ein externer Pfad verwendet.

4. Keine laufende EXE beim Bauen

- Eine geöffnete `Lumberjack.exe` kann den Build sperren und Aktualisierungen verhindern.

```cmd
taskkill /IM Lumberjack.exe /F
npm run build:zip:x64
```

5. Multi-Size ICO sicherstellen

- Wenn Explorer/Taskleiste das Icon weiterhin nicht sauber zeigen, ist oft die ICO-Datei unvollständig.
- Erzeuge `images/icon.ico` mit `npm run icon:generate` neu und baue erneut.

6. Dev vs. Paket

- Im Dev-Start (npm run dev) zeigt die Taskleiste in der Regel das Electron-Icon, weil der Prozess `electron.exe` heißt. Für einen verlässlichen Test immer die gepackte EXE starten.

7. Konfiguration querchecken

- `release/builder-effective-config.yaml` sollte enthalten:
  - `directories.buildResources: images`
  - `win.icon: icon.ico`
  - `appId: de.hhla.lumberjack`

## Performance

Lumberjack is highly optimized for fast startup, responsive UI, and efficient memory usage:

### Startup Performance

- **Cold start**: < 2 seconds (from click to interactive window)
- **Warm start**: < 0.3 seconds (with service worker cache)
- **Bundle size**: 38 KB main bundle (12 KB gzipped)

### Advanced Optimizations

- **Code Splitting**: Rarely-used features loaded on-demand (DC filter, settings)
- **Web Workers**: Heavy parsing offloaded to background threads (non-blocking UI)
- **Service Worker**: Static assets cached for instant subsequent loads
- **Virtual Scrolling**: Handles 100,000+ log entries at 60 FPS
- **Lazy Loading**: Dependencies loaded only when needed

### Memory Efficiency

- Only visible log rows rendered in DOM
- Efficient filtering and search algorithms
- Minimal memory footprint even with large log files

### Details

- Startup optimizations: [PERFORMANCE.md](docs/PERFORMANCE.md)
- Advanced optimizations: [ADVANCED_OPTIMIZATIONS.md](docs/ADVANCED_OPTIMIZATIONS.md)
- **Production-ready optimizations**: [PRODUCTION_OPTIMIZATIONS.md](docs/PRODUCTION_OPTIMIZATIONS.md)
  - Adaptive batch processing (4-100ms dynamic delay)
  - Non-blocking file I/O with AsyncFileWriter
  - Circuit breaker pattern for resilient service calls
  - Token bucket rate limiting
  - Proactive health monitoring (every 60s)
  - Real-time performance metrics tracking

### Production-Ready Features ✅

The application includes enterprise-grade stability and performance features:

- **Adaptive Batching**: Automatically adjusts processing delays based on system load
- **Health Monitoring**: Proactive checks for memory usage, TCP server, and main window
- **Circuit Breaker**: Protects against cascading failures with automatic recovery
- **Rate Limiting**: Prevents system overload with token bucket algorithm
- **Performance Tracking**: Real-time monitoring of memory, CPU, and event loop lag
- **Async File I/O**: Non-blocking writes prevent main thread stalls

See [OPTIMIZATIONS_README.md](docs/OPTIMIZATIONS_README.md) for quick reference and [PRODUCTION_OPTIMIZATIONS.md](docs/PRODUCTION_OPTIMIZATIONS.md) for detailed documentation.

## Troubleshooting & Diagnostik

### Speicher- und Ressourcenprobleme diagnostizieren

Wenn Probleme auftreten, die auf Speicher oder Ressourcen zurückzuführen sein könnten:

1. **Schnelldiagnose ausführen**:
   ```bash
   npm run diagnose:memory
   ```
   
   Dieses Skript analysiert:
   - Systemressourcen (RAM, CPU)
   - Log-Dateien auf Fehler und Warnungen
   - Crash Dumps
   - Anwendungsdaten-Größe
   - Netzwerkverbindungen (TCP/HTTP)

2. **Detaillierte Anleitung lesen**:
   - [Speicher- und Ressourcenprobleme beheben](docs/TROUBLESHOOTING_MEMORY.md)
   
   Dieses Dokument enthält:
   - Symptome von Speicherproblemen
   - Schritt-für-Schritt-Diagnose
   - Lösungen für häufige Probleme
   - Vorbeugende Maßnahmen

### Anwendung beendet sich unerwartet

Wenn die Anwendung sich unerwartet beendet und keine Logs vorhanden sind:

1. **Log-Dateien prüfen**:
   - Windows: `%APPDATA%\Lumberjack\logs\main.log`
   - macOS: `~/Library/Logs/Lumberjack/main.log`
   - Linux: `~/.local/share/Lumberjack/logs/main.log`

2. **Log-Analyse-Skript verwenden**:
   ```bash
   tsx scripts/analyze-exit-logs.ts
   ```

3. **Crash Dumps prüfen**:
   - Crash Dumps werden in `%APPDATA%\Lumberjack\crashes\` gespeichert

4. **Dokumentation lesen**:
   - [Unerklärliche Beendigungen beheben](docs/SILENT_EXIT_FIX.md)
   - [Exit Code 1 Fehler beheben](docs/EXIT_CODE_1_FIX.md)
   - [Node.js Installer Konflikt](docs/NODE_INSTALLER_CONFLICT.md) - **NEU**: Wenn Node.js-Installation interferiert

### Node.js Installer Konflikt (Windows)

Wenn Windows Event Log "Product: Node.js -- A later version of Node.js is already installed" zeigt und die Anwendung kurz darauf abstürzt:

1. **Beenden Sie Lumberjack vor Node.js-Installation/Updates**
2. **System-Node.js ist NICHT erforderlich** - Lumberjack enthält bereits Node.js
3. **Siehe**: [Node.js Installer Konflikt Troubleshooting](docs/NODE_INSTALLER_CONFLICT.md)

Die Anwendung verfügt über umfassende Logging-Funktionen:
- Logs werden sofort auf die Festplatte geschrieben (keine Pufferung)
- Alle Beendigungspfade werden protokolliert
- OS-Signale (SIGTERM, SIGINT) werden abgefangen und protokolliert
- Logs werden alle 5 Sekunden automatisch gespeichert
- Crash Dumps werden bei nativen Abstürzen erstellt
- **NEU**: Erkennung von Installer-Konflikten mit detaillierter Diagnose

## Lizenz

ISC
