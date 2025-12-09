# 🚀 Windows-Startverbesserungen für Build-Versionen

> **Datum:** 10.12.2025  
> **Ziel:** Schnellerer Anwendungsstart auf Windows (Portable & Installer)

---

## 📋 Inhaltsverzeichnis

| Abschnitt                                             | Beschreibung                      |
|-------------------------------------------------------|-----------------------------------|
| [Zusammenfassung](#-zusammenfassung)                  | Übersicht aller Optimierungen     |
| [V8 Code Cache](#-v8-code-cache)                      | JavaScript-Kompilierung cachen    |
| [Hardware-Beschleunigung](#-hardware-beschleunigung)  | GPU-Fallback optimieren           |
| [Vorkompilierte Pfade](#-vorkompilierte-pfade)        | Dateipfad-Auflösung beschleunigen |
| [Background Throttling](#-background-throttling)      | Hintergrund-Performance           |
| [Antivirus-Optimierungen](#️-antivirus-optimierungen) | Windows Defender Ausschlüsse      |
| [Electron Fuses](#-electron-fuses)                    | Sicherheits-Features deaktivieren |
| [ASAR-Optimierungen](#-asar-optimierungen)            | Archiv-Konfiguration              |

---

## 🎯 Zusammenfassung

### Aktuelle Situation

- **Kaltstartzeit**: ~1.5-3s (gut, aber verbesserbar)
- **Icon-Anzeige**: Verzögert in Taskbar
- **Erste Interaktion**: Manchmal träge

### Geplante Verbesserungen

| Optimierung                        | Erwartete Verbesserung | Komplexität  |
|------------------------------------|------------------------|--------------|
| V8 Code Cache                      | 100-300ms              | Niedrig      |
| Background Throttling deaktivieren | 50-100ms               | Sehr niedrig |
| ASAR-Integrität-Check deaktivieren | 50-200ms               | Mittel       |
| Vorkompilierte Pfade               | 20-50ms                | Niedrig      |
| Antivirus-Ausschlüsse (Benutzer)   | 200-500ms              | N/A          |

---

## 🔧 V8 Code Cache

### Problem

Bei jedem Start muss V8 den JavaScript-Code neu parsen und kompilieren. Dies kann bei größeren Apps 100-300ms dauern.

### Lösung

Electron unterstützt V8 Code Caching automatisch, aber wir können es explizit aktivieren:

```typescript
// In src/main/main.ts, vor app.whenReady()

// V8 Code Cache aktivieren für schnelleren Start
app.commandLine.appendSwitch('js-flags', '--cache-script');

// Optional: Garbage Collection optimieren für Start
app.commandLine.appendSwitch('js-flags', '--expose-gc');
```

### electron-builder Konfiguration

```json
// package.json - build Sektion
{
  "build": {
    "asar": true,
    "asarUnpack": [
      "**/*.node"
    ],
    "electronLanguages": [
      "de",
      "en-US"
    ]
  }
}
```

---

## ⚡ Hardware-Beschleunigung

### Problem

Auf manchen Windows-Systemen (besonders VMs oder mit alten Grafiktreibern) kann die Hardware-Beschleunigung den Start
verlangsamen, weil Electron auf GPU-Verfügbarkeit wartet.

### Lösung

Optionale Deaktivierung über Umgebungsvariable:

```typescript
// In src/main/main.ts, ganz am Anfang (vor allen Imports nach electron)

// Hardware-Beschleunigung kann auf problematischen Systemen deaktiviert werden
if (process.env.LUMBERJACK_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration();
    console.log('[startup] Hardware acceleration disabled via environment');
}
```

### Benutzer-Anleitung

Für Benutzer mit Startproblemen:

```batch
:: Lumberjack mit deaktivierter GPU starten
set LUMBERJACK_DISABLE_GPU=1
Lumberjack.exe
```

---

## 📂 Vorkompilierte Pfade

### Problem

Die aktuelle Implementierung prüft mehrere Pfade mit `fs.existsSync()` beim Start. Auf Windows (besonders mit
Antivirenprogrammen) können diese Dateisystemzugriffe langsam sein.

### Lösung

Der Cache (`cachedDistIndexPath`) ist bereits implementiert. Zusätzlich:

```typescript
// In src/main/util/constants.ts

// Bekannte Build-Pfade für schnelleren Zugriff
export const KNOWN_BUILD_PATHS = {
    renderer: 'dist/renderer/index.html',
    preload: 'dist/preload/preload.js',
    icon: {
        win: 'assets/icon.ico',
        mac: 'assets/icon.icns'
    }
} as const;
```

---

## 🔄 Background Throttling

### Problem

Electron drosselt standardmäßig Hintergrund-Tabs/Fenster. Bei Single-Window-Apps kann dies unnötig sein.

### Lösung

```typescript
// In createWindow(), bei webPreferences:
webPreferences: {
    // ...existing code...
    backgroundThrottling: false, // Verhindert Drosselung bei Fokusverlust
}
```

---

## 🛡️ Antivirus-Optimierungen

### Problem

Windows Defender und andere Antivirenprogramme scannen jede .exe und .node Datei beim Start. Dies kann 200-1000ms
hinzufügen.

### Benutzer-Dokumentation

```markdown
## Antivirus-Ausschlüsse (Empfohlen für regelmäßige Nutzung)

### Windows Defender

1. Windows-Sicherheit öffnen
2. Viren- & Bedrohungsschutz → Einstellungen verwalten
3. Ausschlüsse → Ausschluss hinzufügen → Ordner
4. Folgende Pfade hinzufügen:
    - `C:\Users\<Username>\AppData\Local\Programs\Lumberjack`
    - Oder: Portable-Ordner

### Automatischer Ausschluss (Code)

Die App kann Windows Defender-Ausschlüsse vorschlagen:
```

### Implementierung (Optional)

```typescript
// In src/main/util/windowsDefender.ts
import {exec} from 'child_process';
import {app} from 'electron';
import * as path from 'path';

export function suggestDefenderExclusion(): void {
    if (process.platform !== 'win32') return;

    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : app.getAppPath();

    // Zeige dem Benutzer, wie er den Ausschluss hinzufügen kann
    // (keine automatische Änderung ohne Admin-Rechte)
}
```

---

## 🔐 Electron Fuses

### Problem

Electron Fuses sind Sicherheitsfeatures, die zur Laufzeit geprüft werden. Einige davon können deaktiviert werden, wenn
sie nicht benötigt werden.

### electron-builder Konfiguration

```javascript
// forge.config.js oder electron-builder Konfiguration
const {FusesPlugin} = require('@electron-forge/plugin-fuses');
const {FuseV1Options, FuseVersion} = require('@electron/fuses');

// Fuses für schnelleren Start (optional)
module.exports = {
    plugins: [
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false, // Sicherheit
            [FuseV1Options.EnableCookieEncryption]: false, // Schnellerer Start
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // Sicherheit
            [FuseV1Options.EnableNodeCliInspectArguments]: false, // Sicherheit
        }),
    ],
};
```

---

## 📦 ASAR-Optimierungen

### Aktuelle Konfiguration

```json
{
  "build": {
    "asar": true,
    "asarUnpack": [
      "**/*.node"
    ],
    "compression": "store"
  }
}
```

### Optimierungen

| Einstellung         | Aktuell     | Empfehlung    | Grund                              |
|---------------------|-------------|---------------|------------------------------------|
| `compression`       | `store`     | ✅ `store`     | Schnellster Zugriff                |
| `asarUnpack`        | `**/*.node` | ✅ Beibehalten | Native Module müssen entpackt sein |
| `electronLanguages` | `de, en-US` | ✅ Beibehalten | Nur benötigte Locales              |

---

## 🔍 Diagnose & Messungen

### Performance-Logging aktivieren

```typescript
// Am Anfang von main.ts
const startupTime = Date.now();
console.log('[STARTUP] Process start:', startupTime);

// Nach createWindow
console.log('[STARTUP] Window created:', Date.now() - startupTime, 'ms');

// Nach ready-to-show
console.log('[STARTUP] Ready to show:', Date.now() - startupTime, 'ms');
```

### Windows Event Log Integration

```typescript
// Optional: Windows Event Log für Diagnose
if (process.platform === 'win32') {
    process.on('uncaughtException', (err) => {
        // Windows Event Log schreiben für Diagnose
        console.error('[WINDOWS_EVENT] Uncaught exception:', err.message);
    });
}
```

---

## ✅ Implementierungsplan

### Phase 1: Schnelle Wins (✅ UMGESETZT)

- [x] `backgroundThrottling: false` in webPreferences hinzugefügt
- [x] Performance-Logging verbessert (`ready-to-show` Timing + Warnungen)
- [x] GPU-Fallback-Option (`LUMBERJACK_DISABLE_GPU=1`)
- [x] V8 Turbo-Optimierungen (`--turbo-fast-api-calls`)
- [x] Windows-spezifische Chromium-Flags:
  - `--disable-background-timer-throttling`
  - `--disable-renderer-backgrounding`

### Phase 2: Mittelfristig

- [ ] Electron Fuses konfigurieren (optional)
- [ ] V8 Snapshot für besonders schnellen Start (nur bei Bedarf)

### Phase 3: Dokumentation

- [x] Benutzer-Guide für Antivirus-Ausschlüsse (siehe oben)
- [x] Troubleshooting-Guide für langsamen Start

---

## 📊 Erwartete Ergebnisse

| Metrik            | Vorher | Nachher (Ziel) |
|-------------------|--------|----------------|
| Kaltstart         | ~2-3s  | < 1.5s         |
| Warmstart         | ~0.5s  | < 0.3s         |
| Icon in Taskbar   | ~1s    | < 0.5s         |
| Erste Interaktion | ~2s    | < 1s           |

---

## 🔧 Implementierte Code-Änderungen

### In `src/main/main.ts`:

```typescript
// 1. Startup-Zeit tracking (ganz oben)
const processStartTime = Date.now();

// 2. GPU-Fallback für problematische Systeme
if (process.env.LUMBERJACK_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
}

// 3. V8 Optimierungen
app.commandLine.appendSwitch("js-flags", "--turbo-fast-api-calls");

// 4. Windows-spezifische Chromium-Flags
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}

// 5. backgroundThrottling in webPreferences
webPreferences: {
  backgroundThrottling: false,
  // ...existing preferences...
}

// 6. Performance-Logging bei ready-to-show
win.once("ready-to-show", () => {
  const readyToShowTime = Date.now() - processStartTime;
  log.info(`[PERF] Window ready-to-show: ${readyToShowTime}ms`);
  if (readyToShowTime > 3000) {
    log.warn(`[PERF] Slow startup detected (${readyToShowTime}ms).`);
  }
  // ...
});
```

---

*Lumberjack Windows Startup Optimierungen - 10.12.2025*

