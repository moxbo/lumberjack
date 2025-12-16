# Node.js Installer Conflict - Troubleshooting Guide

## Problem Description

Die Lumberjack-Anwendung kann abstürzen, wenn gleichzeitig versucht wird, Node.js auf dem System zu installieren oder zu aktualisieren. Dies manifestiert sich typischerweise durch folgende Symptome:

### Symptome
- Windows Event Log zeigt die Meldung: "Product: Node.js -- A later version of Node.js is already installed. Setup will now exit."
- Kurz darauf stürzt die Lumberjack-Anwendung ab
- Die Anwendung lässt sich möglicherweise nicht mehr starten

## Root Cause

Das Problem tritt auf, wenn:

1. **Windows Installer versucht, Node.js zu installieren/aktualisieren**, während Lumberjack läuft
2. **Der Node.js Installer findet eine neuere Version** und bricht mit einer Fehlermeldung ab
3. **Die Interferenz zwischen Windows Installer und der laufenden Electron-Anwendung** führt zu einem Crash

### Warum passiert das?

- **Electron enthält eine eigene Node.js Runtime**: Lumberjack ist eine Electron-Anwendung und enthält bereits eine eingebettete Node.js-Version (Version ${process.versions.node})
- **System-Node.js ist nicht erforderlich**: Die Anwendung benötigt keine separat installierte Node.js-Version auf dem System
- **Windows Installer Konflikt**: Wenn der Windows Installer versucht, Node.js zu installieren, kann dies mit der laufenden Electron-Anwendung interferieren

## Präventionsmaßnahmen

### Für Benutzer

1. **Nicht Node.js installieren während Lumberjack läuft**
   - Beenden Sie Lumberjack vollständig (über Menü → Beenden)
   - Führen Sie dann Node.js-Installation/Update durch
   - Starten Sie Lumberjack anschließend neu

2. **System-Node.js ist nicht erforderlich**
   - Lumberjack benötigt **keine** separate Node.js-Installation
   - Die Anwendung funktioniert unabhängig von System-Node.js
   - Sie können Lumberjack auch ohne System-Node.js verwenden

3. **Windows Updates planen**
   - Planen Sie Windows Updates außerhalb der Arbeitszeiten
   - Beenden Sie alle Anwendungen vor größeren System-Updates

### Für Administratoren

1. **Deployment-Strategie**
   - Verwenden Sie die portable Version (`Lumberjack-${version}-x64.exe`) für einfache Bereitstellung
   - Die portable Version benötigt keine Installation und vermeidet Installer-Konflikte

2. **Group Policy Configuration**
   - Konfigurieren Sie Windows Update Group Policies
   - Verhindern Sie automatische Installation von Node.js durch Drittanbieter-Software

3. **Application Monitoring**
   - Überwachen Sie Crash-Logs in `%APPDATA%\Lumberjack\logs\main.log`
   - Suchen Sie nach Einträgen mit "child-process-gone" oder "uncaughtException"

## Technische Details

### Warum Electron eine eigene Node.js Runtime hat

Electron-Anwendungen sind selbstständige Programme, die:
- Eine spezifische, getestete Node.js-Version enthalten
- Keine Abhängigkeit von System-Node.js haben
- Konsistenz über verschiedene Systeme gewährleisten

### Lumberjack's Node.js Version

Lumberjack verwendet:
- **Electron Version**: 38.4.0
- **Eingebettete Node.js Version**: ${process.versions.node}
- **Chrome Version**: ${process.versions.chrome}

Diese Versionen sind fest in der Anwendung integriert und können nicht durch System-Node.js überschrieben werden.

## Diagnoseschritte

Wenn das Problem auftritt:

### 1. Log-Dateien prüfen

```cmd
notepad %APPDATA%\Lumberjack\logs\main.log
```

Suchen Sie nach:
- `[diag] uncaughtException` - Unerwartete Fehler
- `[diag] child-process-gone` - Child-Prozess-Abstürze
- `[diag] exit` - Exit-Informationen

### 2. Windows Event Log prüfen

```cmd
eventvwr.msc
```

Navigieren Sie zu:
- **Windows Logs → Application**
- Filtern Sie nach "Node.js" oder "MsiInstaller"
- Prüfen Sie Zeitstempel der Events

### 3. Prozesse prüfen

```cmd
tasklist | findstr /i "node electron lumberjack"
```

Stellen Sie sicher, dass keine verwaisten Prozesse laufen.

## Implementierte Schutzmaßnahmen

Die Anwendung enthält jetzt folgende Schutzmaßnahmen:

### 1. Verbesserte Crash-Erkennung

```typescript
// Spezifische Erkennung für Installer-Konflikte
if (err?.message?.includes("installer") || 
    err?.message?.includes("EBUSY") ||
    err?.code === "EACCES") {
  log.warn("[installer-conflict] Potential installer interference detected");
}
```

### 2. Automatische Recovery

- Fenster wird bei Renderer-Crashes automatisch neu geladen
- 500ms Verzögerung verhindert Crash-Loops
- Vollständige Diagnose-Logs für Fehleranalyse

### 3. Graceful Degradation

- Anwendung versucht weiterzulaufen, auch bei Teilausfällen
- Kritische Funktionen sind geschützt
- Benutzer wird bei Problemen informiert

## Lösungsschritte bei aufgetretenem Problem

### Schritt 1: Anwendung vollständig beenden

```cmd
taskkill /IM Lumberjack.exe /F
```

### Schritt 2: Verwaiste Prozesse bereinigen

```cmd
taskkill /IM electron.exe /F
taskkill /IM node.exe /F
```

### Schritt 3: Temporäre Dateien löschen (optional)

```cmd
del /q %TEMP%\lumberjack*
rd /s /q %APPDATA%\Lumberjack\Cache
```

### Schritt 4: Anwendung neu starten

Starten Sie Lumberjack normal über das Desktop-Icon oder Startmenü.

### Schritt 5: Log-Dateien sichern (für Support)

```cmd
xcopy %APPDATA%\Lumberjack\logs\* C:\Support\Lumberjack-Logs\ /E /I
```

## Vorbeugende Maßnahmen

### Für die Zukunft

1. **Beenden Sie Lumberjack vor System-Updates**
2. **Installieren Sie keine zusätzliche Node.js-Version** (nicht erforderlich)
3. **Verwenden Sie die portable Version** für maximale Stabilität
4. **Überwachen Sie regelmäßig die Log-Dateien** auf Warnungen

### Wenn häufige Crashes auftreten

1. Prüfen Sie, ob automatische Updates Node.js installieren
2. Deaktivieren Sie automatische Node.js-Updates über Group Policy
3. Verwenden Sie Task Scheduler, um Lumberjack zu beenden vor geplanten Updates

## Support-Informationen

### Log-Dateien Speicherorte

- **Haupt-Log**: `%APPDATA%\Lumberjack\logs\main.log`
- **Renderer-Logs**: Browser-Konsole (F12)
- **Crash-Dumps**: `%APPDATA%\Lumberjack\crashes\`

### Wichtige Diagnoseinformationen

Wenn Sie Support benötigen, sammeln Sie:
1. Log-Dateien aus `%APPDATA%\Lumberjack\logs\`
2. Windows Event Log Einträge (Export als EVTX)
3. Zeitstempel des Crashes
4. Informationen über laufende Node.js/Windows Updates

## Zusammenfassung

- **Lumberjack benötigt keine separate Node.js-Installation**
- **Windows Installer Konflikte können zu Crashes führen**
- **Beenden Sie Lumberjack vor Node.js-Installation/Updates**
- **Die Anwendung enthält jetzt bessere Schutzmaßnahmen**
- **Bei Problemen: Logs prüfen und Anwendung neu starten**

## Siehe auch

- [EXIT_CODE_1_FIX.md](./EXIT_CODE_1_FIX.md) - Allgemeine Exit-Code-Probleme
- [SILENT_EXIT_FIX.md](./SILENT_EXIT_FIX.md) - Stille Exits ohne Logs
- [TROUBLESHOOTING_MEMORY.md](./TROUBLESHOOTING_MEMORY.md) - Speicherprobleme
