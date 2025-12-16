# 🚀 Windows Portable Startup-Optimierung

> **Datum:** 17.12.2025  
> **Ziel:** Schnellerer Kaltstart der Windows Portable Version

---

## 📋 Zusammenfassung der Änderungen

### Problem

Die Windows Portable Version hatte einen langsamen Kaltstart (2-4 Sekunden), besonders auf Systemen mit:
- Antivirus-Software (Windows Defender)
- Langsamen Festplatten
- Älteren CPUs

### Implementierte Optimierungen

| Optimierung | Erwartete Verbesserung | Komplexität |
|-------------|------------------------|-------------|
| V8 Code Cache (`--v8-cache-options=code`) | 100-300ms | Sehr niedrig |
| GC-Kontrolle (`--expose-gc`) | 50-100ms | Sehr niedrig |
| Chromium Feature-Deaktivierung | 50-150ms | Sehr niedrig |
| Preload-Pfad-Caching | 20-50ms | Niedrig |
| Verzögerte Log-Directory-Validierung | 30-100ms | Niedrig |
| Verzögerter Health Monitor Start | 20-50ms | Niedrig |
| `requestedExecutionLevel: asInvoker` | 100-300ms (UAC) | Sehr niedrig |

**Geschätzte Gesamtverbesserung: 400-1000ms**

---

## 🔧 Technische Details

### 1. V8 Code Cache

```typescript
// Aktiviert V8's Code-Caching für schnelleren nachfolgenden Start
app.commandLine.appendSwitch("v8-cache-options", "code");

// Ermöglicht manuelle GC-Kontrolle für optimierte Speichernutzung
app.commandLine.appendSwitch("js-flags", "--turbo-fast-api-calls --expose-gc");
```

V8 Code Cache speichert den kompilierten JavaScript-Bytecode, sodass bei nachfolgenden Starts die Kompilierung übersprungen werden kann.

### 2. Deaktivierte Chromium-Features

```typescript
if (process.platform === "win32") {
  // Deaktiviert Hintergrund-Throttling für konsistente Performance
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  
  // Überspringt GPU-Info-Sammlung (kann auf manchen Systemen langsam sein)
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  
  // Deaktiviert unnötige Chromium-Features für schnellere Initialisierung
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService");
  
  // Schnellere Font-Rendering-Initialisierung
  app.commandLine.appendSwitch("disable-font-subpixel-positioning");
  
  // Reduziert IPC-Startup-Overhead
  app.commandLine.appendSwitch("disable-ipc-flooding-protection");
}
```

### 3. Preload-Pfad-Caching

```typescript
let cachedPreloadPath: string | null = null;
function resolvePreloadPath(): string {
  if (cachedPreloadPath) return cachedPreloadPath;
  // ... Pfad-Auflösung nur beim ersten Aufruf
}
```

Vermeidet wiederholte `fs.existsSync()`-Aufrufe bei der Window-Erstellung.

### 4. Verzögerte nicht-kritische Aufgaben

```typescript
// Log-Directory-Validierung verzögert
setImmediate(() => {
  // Validierung läuft nach Window-Anzeige
});

// Health Monitor startet 5 Sekunden nach Startup
setTimeout(() => {
  setInterval(() => healthMonitor.runChecks(), 60000);
}, 5000);
```

### 5. Electron-Builder Portable-Konfiguration

```json
{
  "win": {
    "requestedExecutionLevel": "asInvoker"
  },
  "portable": {
    "artifactName": "Lumberjack-${version}-${arch}-portable.${ext}",
    "unpackDirName": "Lumberjack-portable",
    "splashImage": false
  }
}
```

- `requestedExecutionLevel: asInvoker`: Verhindert UAC-Prompts beim Start
- `splashImage: false`: Deaktiviert das Splash-Image für schnelleren Start

---

## 📊 Performance-Messung

Die App loggt automatisch Performance-Metriken:

```
[PERF] app.whenReady() fired after XXXms
[PERF] Initial window created after XXXms
[PERF] Window ready-to-show: XXXms
```

### Zielwerte

| Metrik | Vorher | Nachher (Ziel) |
|--------|--------|----------------|
| Kaltstart | 2-4s | < 1.5s |
| Warmstart | 0.5-1s | < 0.5s |
| Erste Interaktion | 2-3s | < 1.5s |

---

## 🛠️ Benutzer-Empfehlungen

### Windows Defender Ausschlüsse

Für optimale Startzeit empfehlen wir, den Portable-Ordner vom Echtzeit-Scan auszuschließen:

1. Windows-Sicherheit öffnen
2. Viren- & Bedrohungsschutz → Einstellungen verwalten
3. Ausschlüsse → Ausschluss hinzufügen → Ordner
4. Den Lumberjack-Portable-Ordner hinzufügen

### GPU-Probleme

Bei Startproblemen auf Systemen mit problematischen Grafiktreibern:

```batch
:: Lumberjack mit deaktivierter GPU starten
set LUMBERJACK_DISABLE_GPU=1
Lumberjack.exe
```

---

## ✅ Implementierungs-Checkliste

- [x] V8 Code Caching aktiviert
- [x] Manuelle GC-Kontrolle aktiviert
- [x] Chromium Feature-Deaktivierung für Windows
- [x] Preload-Pfad-Caching implementiert
- [x] Log-Directory-Validierung verzögert
- [x] Health Monitor Start verzögert
- [x] `requestedExecutionLevel: asInvoker` konfiguriert
- [x] Portable-spezifische Build-Konfiguration
- [x] Performance-Logging verbessert

---

*Lumberjack Windows Portable Startup-Optimierung - 17.12.2025*

