# 🚀 Portable Startup-Optimierung Update (Januar 2026)

> **Datum:** 15.01.2026  
> **Ziel:** Weitere Beschleunigung des Kaltstarts der Windows Portable Version

---

## 📦 Windows-Distributionsoptionen

Nach dem Build stehen **drei Windows-Distributionen** zur Verfügung:

| Distribution       | Datei            | Erster Start       | Folgende Starts | Ideal für                 |
|--------------------|------------------|--------------------|-----------------|---------------------------|
| **NSIS Installer** | `*-setup.exe`    | ~1-2s              | ~1-2s           | Feste Installation        |
| **Portable EXE**   | `*-portable.exe` | ~3-5s (Extraktion) | ~1-2s           | Einzelne Datei, USB-Stick |
| **ZIP Archiv**     | `*-win.zip`      | ~1-2s              | ~1-2s           | **Schnellster Start**     |

### Empfehlung für schnellsten Start

1. **Für regelmäßige Nutzung**: ZIP-Version herunterladen und einmal entpacken
2. **Für USB-Stick/Portabilität**: Portable EXE (akzeptiert längeren ersten Start)
3. **Für Installation**: NSIS Installer

---

## 🔧 Optimierungen: Installiert vs. Portable

Die App erkennt automatisch, ob sie **installiert** oder **portabel** läuft:

- **Installiert**: Pfad enthält `Program Files` oder `AppData\Local\Programs`
- **Portable**: Alle anderen Pfade (Desktop, USB-Stick, beliebiger Ordner)

### Optimierungen für ALLE Windows-Versionen

| Flag | Beschreibung |
|------|--------------|
| `--v8-cache-options=code` | V8 Code Caching |
| `--disable-features=...` | Unnötige Chromium-Features deaktiviert |
| `--no-pings` | Keine Tracking-Pings |
| `--disable-ipc-flooding-protection` | Schnellerer IPC |
| `--disable-background-timer-throttling` | Kein Throttling im Hintergrund |
| `--disable-renderer-backgrounding` | Renderer bleibt aktiv |
| `--disable-component-update` | Keine Chromium-Updates |
| `--disable-background-networking` | Kein Hintergrund-Networking |
| `--disable-field-trial-config` | Keine Field Trials |
| `--no-default-browser-check` | Keine Browser-Prüfung |
| `--no-first-run` | First-Run Tasks überspringen |
| `--disable-domain-reliability` | Domain Reliability deaktiviert |

### Zusätzliche Optimierungen NUR für Portable

Diese aggressiveren Optimierungen werden **nur aktiviert wenn die App NICHT installiert ist**:

| Flag | Beschreibung | Grund für Portable-Only |
|------|--------------|-------------------------|
| `--disable-gpu-sandbox` | GPU-Sandbox deaktiviert | Kann Stabilitätsprobleme verursachen |
| `--disable-font-subpixel-positioning` | Einfacheres Font-Rendering | Reduzierte Textqualität |
| `--disable-dev-shm-usage` | Shared Memory deaktiviert | Kann bei großen Daten problematisch sein |
| `--disable-gpu-vsync` | VSync deaktiviert | Kann Tearing verursachen |
| `--disable-accelerated-2d-canvas` | Hardware-Canvas deaktiviert | Langsameres Canvas-Rendering |
| `--in-process-gpu` | GPU im Hauptprozess | Weniger stabil bei GPU-Crashes |
| `--disable-logging` | Chromium-Logging aus | Erschwert Debugging |
| `--disable-direct-write` | DirectWrite deaktiviert | Schlechteres Font-Rendering |

**Log-Ausgabe bei Portable:**
```
[startup] Portable mode detected - aggressive optimizations enabled
```

---

## 📋 Weitere implementierte Optimierungen

### 1. Portable-Build mit ZIP-Extraktion

Die `useZip: true` Option wurde in `package.json` aktiviert:

```json
"portable": {
  "useZip": true,
  ...
}
```

**Vorteile:**
- Schnelleres Entpacken beim ersten Start
- Kleinere Portable-Datei
- Schnellerer I/O-Zugriff nach Extraktion

**Erwartete Verbesserung: 100-300ms (beim ersten Start)**

### 2. Critical CSS Inlining

In `index.html` wurde kritisches CSS inline hinzugefügt:

```html
<style>
  body {
    margin: 0;
    background-color: #0f1113;
    font-family: system-ui, ...;
  }
  #app { min-height: 100vh; }
</style>
```

**Vorteile:**
- Kein separater CSS-Fetch für initiales Rendering
- Schnellerer First Contentful Paint (FCP)
- Verhindert Flash of Unstyled Content (FOUC)

**Erwartete Verbesserung: 30-100ms**

---

## 📊 Gesamte erwartete Verbesserung

| Bereich | Verbesserung |
|---------|--------------|
| Chromium Flags | 230-500ms |
| ZIP-Extraktion | 100-300ms (erster Start) |
| Critical CSS | 30-100ms |
| **Gesamt** | **360-900ms** |

---

## 🔧 Bereits vorhandene Optimierungen

Diese Optimierungen waren bereits implementiert:

### Main Process
- V8 Code Cache (`--v8-cache-options=code`)
- Turbo Fast API Calls (`--turbo-fast-api-calls`)
- Background Throttling deaktiviert
- Hardware Acceleration Fallback
- Lazy Module Loading (AdmZip, Parsers, AutoUpdater)
- Preload Path Caching
- Dist Index Path Caching
- Asynchrone Settings-Ladung
- Verzögerte Health Checks (5s Delay)

### Build-Konfiguration
- ASAR Compression: `store` (kein Entpacken nötig)
- `requestedExecutionLevel: asInvoker` (kein UAC)
- `splashImage: false`
- Nur benötigte Sprachen (`de`, `en-US`)

### Renderer
- Lazy-loaded Dialoge
- Code Splitting für selten genutzte Features
- Preact statt React (3KB vs 40KB+)
- Cached Settings im Preload

---

## 🧪 Performance messen

### Windows PowerShell

```powershell
# Portable Version bauen
npm run build:portable:x64

# Kaltstart messen (nach Neustart)
Measure-Command { Start-Process ".\release\build\Lumberjack-*-portable.exe" -Wait }

# Mehrere Starts messen
1..5 | ForEach-Object { 
  Measure-Command { Start-Process ".\release\build\Lumberjack-*-portable.exe" -Wait } 
} | Select-Object TotalMilliseconds
```

### Im App-Log prüfen

Nach dem Start erscheinen Performance-Marker im Log:

```
[PERF] Window ready-to-show: XXXms
```

**Zielwerte:**
- Kaltstart: < 1.5s
- Warmstart: < 0.5s

---

## 🛡️ Empfehlungen für Benutzer

### Windows Defender Ausschluss

Für optimale Startzeit den Portable-Ordner ausschließen:

1. Windows-Sicherheit öffnen
2. Viren- & Bedrohungsschutz → Einstellungen verwalten
3. Ausschlüsse → Ausschluss hinzufügen → Ordner
4. Den Lumberjack-Portable-Ordner auswählen

### Antivirus-Software

Einige Antivirenprogramme scannen bei jedem Start. Erwägen Sie:
- Lumberjack-Ordner zur Whitelist hinzufügen
- Echtzeit-Scan für den Ordner deaktivieren

---

## 🔜 Zukünftige Möglichkeiten

Falls weitere Optimierungen nötig sind:

1. **V8 Snapshot** - Eigener V8-Snapshot mit vorkompiliertem Code
2. **Electron Fuses** - Sicherheitsfeatures selektiv deaktivieren
3. **NSIS statt Portable** - Installierte Version ist generell schneller
4. **SSD empfehlen** - HDD-Zugriff ist Hauptflaschenhals

---

*Lumberjack Portable Startup-Optimierung - 15.01.2026*

