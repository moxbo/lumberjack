# Speicher- und Ressourcen-Probleme beheben

[English version available below](#troubleshooting-memory-and-resource-issues)

## Überblick

Wenn Lumberjack weiterhin Probleme aufweist, die auf Speicher oder Ressourcen zurückzuführen sein könnten, hilft dieser Leitfaden bei der Diagnose und Behebung.

## Symptome von Speicherproblemen

### 1. Anwendung wird langsamer über Zeit
- UI reagiert verzögert
- Scrolling wird ruckelig
- Filter dauern länger

**Mögliche Ursache**: Speicherleck oder zu viele Log-Einträge im Speicher

### 2. Anwendung stürzt ab oder beendet sich unerwartet
- Fenster schließt sich plötzlich
- "Out of Memory" Fehler
- Keine Reaktion mehr (hängt)

**Mögliche Ursache**: Speichererschöpfung

### 3. Hoher Speicherverbrauch
- Windows Task-Manager zeigt hohen RAM-Verbrauch
- Speicher steigt kontinuierlich an
- Andere Anwendungen werden langsam

**Mögliche Ursache**: Speicherleck oder große Log-Dateien

### 4. Netzwerk-Funktionen verursachen Probleme
- TCP-Verbindungen häufen sich an
- HTTP-Polling verbraucht viel Speicher
- Verbindungen werden nicht richtig geschlossen

**Mögliche Ursache**: Netzwerk-Ressourcenleck

## Schnelle Diagnose durchführen

### Schritt 1: Logs prüfen

Die Anwendung schreibt ausführliche Logs:

**Windows**: 
```
%APPDATA%\Lumberjack\logs\main.log
```

**macOS**: 
```
~/Library/Logs/Lumberjack/main.log
```

**Linux**: 
```
~/.local/share/Lumberjack/logs/main.log
```

**Was Sie suchen sollten:**
- `[tcp]` Einträge - TCP-Verbindungsprobleme
- `[http:poll]` Einträge - HTTP-Polling-Probleme
- `Buffer overflow` - Pufferüberlauf-Schutz aktiviert
- `Trimmed seen Set` - Deduplizierung-Speicherschutz aktiviert
- `Memory` oder `OOM` - Speicherprobleme

### Schritt 2: Crash Dumps prüfen

Bei nativen Abstürzen werden Crash Dumps erstellt:

**Windows**: 
```
%APPDATA%\Lumberjack\crashes\
```

**macOS/Linux**: 
```
~/Library/Application Support/Lumberjack/crashes/
```

Wenn Crash Dumps vorhanden sind, deutet das auf native Abstürze hin (V8, GPU, etc.).

### Schritt 3: Ressourcenverbrauch überwachen

#### Windows Task-Manager
1. `Strg+Shift+Esc` drücken
2. "Details" Tab
3. Nach "Lumberjack.exe" suchen
4. Speicher- und CPU-Verbrauch beobachten

**Normal**: 50-200 MB bei moderater Nutzung
**Problematisch**: >500 MB oder kontinuierlicher Anstieg

#### macOS Activity Monitor
1. `Cmd+Space` → "Activity Monitor"
2. Nach "Lumberjack" suchen
3. Speicher und CPU beobachten

#### Linux (htop/top)
```bash
htop
# Nach "lumberjack" filtern (F4)
```

### Schritt 4: Diagnostik-Skript ausführen

Das Repository enthält ein Diagnose-Skript:

```bash
npm run diagnose:memory
```

Dies prüft:
- ✅ Log-Dateien auf Fehler
- ✅ Crash Dumps
- ✅ Aktive Netzwerkverbindungen
- ✅ Speicher-Trends
- ✅ Bekannte Problemmuster

## Detaillierte Diagnose

### Netzwerk-Funktionen prüfen

Wenn Sie TCP-Server oder HTTP-Polling verwenden:

#### 1. Aktive Verbindungen prüfen

Die Logs zeigen aktive TCP-Verbindungen:
```
[tcp] Socket connected: 192.168.1.100:54321 (active: 5)
[tcp] Socket cleaned up: 192.168.1.100:54321 (active: 4)
```

**Normal**: Verbindungen werden geschlossen (`cleaned up`)
**Problem**: Viele `connected`, aber keine `cleaned up` Einträge

#### 2. HTTP-Polling-Speicher prüfen

Die Logs zeigen, wenn der Deduplizierungs-Speicher getrimmt wird:
```
[http:poll] Trimmed seen Set to 5000 entries (was 10001)
```

**Normal**: Gelegentliches Trimmen
**Problem**: Sehr häufiges Trimmen (jede Minute) - deutet auf viele eindeutige Einträge hin

#### 3. Pufferüberläufe prüfen

Warnung bei Pufferüberlauf:
```
[tcp] Buffer overflow on 192.168.1.100:54321, dropping oldest data
```

**Normal**: Selten oder nie
**Problem**: Häufig - deutet auf Clients hin, die zu viele Daten senden

### Speicherlecks identifizieren

#### 1. Baseline erstellen
1. Anwendung frisch starten
2. Speicherverbrauch notieren (z.B. 100 MB)
3. Normal verwenden (1 Stunde)
4. Speicherverbrauch erneut prüfen

**Normal**: Anstieg auf 150-200 MB, dann stabil
**Problem**: Kontinuierlicher Anstieg (100 → 200 → 300 → 400 MB)

#### 2. Speicherwachstum über Zeit beobachten

Speicherverbrauch alle 10 Minuten notieren:
```
Zeit    Speicher
10:00   120 MB
10:10   125 MB
10:20   128 MB
10:30   130 MB
10:40   132 MB
10:50   133 MB  ← Stabilisiert sich
11:00   133 MB
```

**Normal**: Wächst initial, stabilisiert sich dann
**Problem**: Kontinuierliches Wachstum ohne Plateau

### System-Ressourcen prüfen

#### 1. Verfügbarer Speicher
Stellen Sie sicher, dass genug RAM verfügbar ist:

**Windows**: Task-Manager → Leistung → Speicher
**macOS**: Activity Monitor → Speicher
**Linux**: `free -h`

**Empfohlen**: Mindestens 2 GB freier RAM

#### 2. Festplattenspeicher
Log-Dateien benötigen Speicherplatz:

**Windows**: 
```cmd
dir %APPDATA%\Lumberjack
```

**macOS/Linux**: 
```bash
du -sh ~/Library/Logs/Lumberjack
```

**Normal**: <100 MB für Logs
**Problem**: >1 GB - alte Logs können gelöscht werden

#### 3. Offene Dateien / Dateideskriptoren

Bei vielen TCP-Verbindungen:

**Linux**: 
```bash
lsof -p $(pgrep -f lumberjack) | wc -l
```

**Normal**: <1000
**Problem**: >5000 - deutet auf nicht geschlossene Dateien/Sockets hin

## Lösungen

### Lösung 1: Anwendung neu starten

Einfachste Lösung für temporäre Probleme:
1. Lumberjack komplett beenden
2. Task-Manager prüfen - alle Prozesse beenden
3. Neu starten

### Lösung 2: Alte Logs löschen

Log-Dateien können groß werden:

**Windows**: 
```cmd
del %APPDATA%\Lumberjack\logs\*.old
```

**macOS/Linux**: 
```bash
rm ~/Library/Logs/Lumberjack/*.old
```

### Lösung 3: Netzwerk-Limits anpassen

Bei vielen TCP-Verbindungen oder HTTP-Polling:

Die Anwendung hat eingebaute Limits:
- **TCP-Verbindungen**: Max 1000 gleichzeitig
- **HTTP-Response**: Max 100 MB
- **TCP-Timeout**: 5 Minuten
- **HTTP-Timeout**: 30 Sekunden

Diese sind normalerweise ausreichend. Bei Problemen:
1. Anzahl gleichzeitiger Clients reduzieren
2. HTTP-Polling-Intervall erhöhen
3. Große Log-Dateien in kleinere aufteilen

### Lösung 4: Große Log-Dateien handhaben

Wenn Sie sehr große Log-Dateien laden (>100 MB):

**Option A**: Datei aufteilen
```bash
# Linux/macOS
split -l 100000 huge.log chunk_

# Windows (PowerShell)
Get-Content huge.log -ReadCount 100000 | Set-Content chunk_$count.log
```

**Option B**: Nur relevante Teile laden
```bash
# Letzte 50000 Zeilen
tail -n 50000 huge.log > recent.log
```

### Lösung 5: Filter optimieren

Komplexe Filter können langsam sein:

**Ineffizient**: Viele verschachtelte ORs
```
term1|term2|term3|term4|term5|term6|term7|term8
```

**Besser**: Spezifischere Filter
```
error&service
```

### Lösung 6: Browser-Cache leeren

Die UI nutzt Service Workers für Caching:

1. Einstellungen öffnen
2. "Cache leeren" (falls verfügbar)
3. Oder: Anwendungsdaten löschen:
   - Windows: `%APPDATA%\Lumberjack\`
   - Unterordner `Cache\` und `Service Worker\` löschen

## Vorbeugende Maßnahmen

### 1. Regelmäßig Logs prüfen
```bash
# Wöchentlich logs prüfen
tail -n 1000 %APPDATA%\Lumberjack\logs\main.log
```

Auf Warnungen achten:
- Buffer overflow
- Connection limit
- Trimmed seen Set

### 2. Netzwerkverbindungen überwachen

Bei Nutzung von TCP-Server oder HTTP-Polling:
- Aktive Verbindungen sollten sich nicht häufen
- Logs sollten Cleanup-Meldungen zeigen
- Speicher sollte sich stabilisieren

### 3. Speicher regelmäßig überwachen

Ersten Monat nach Deployment:
- Wöchentlich Speicherverbrauch prüfen
- Trends dokumentieren
- Bei kontinuierlichem Wachstum: Logs an Entwickler senden

### 4. Updates installieren

Neuere Versionen enthalten oft Fixes:
- GitHub Releases prüfen
- Changelog lesen
- Wichtige Updates zeitnah installieren

## Hilfe holen

### Was Sie bereitstellen sollten

Bei Meldung eines Problems:

1. **Logs** (letzte 500 Zeilen):
   ```cmd
   # Windows
   powershell -Command "Get-Content %APPDATA%\Lumberjack\logs\main.log -Tail 500"
   ```

2. **Systeminfo**:
   - OS Version (Windows 10/11, macOS Ventura, Ubuntu 22.04, etc.)
   - RAM gesamt und verfügbar
   - Lumberjack Version

3. **Speicher-Trend**:
   - Anfangsspeicher (z.B. 100 MB)
   - Nach 1 Stunde (z.B. 150 MB)
   - Nach 4 Stunden (z.B. 300 MB)

4. **Nutzungsmuster**:
   - Große Log-Dateien? Wie groß?
   - TCP-Server aktiv? Wie viele Verbindungen?
   - HTTP-Polling aktiv? Wie viele URLs?
   - Filter aktiv? Welche?

5. **Crash Dumps** (falls vorhanden):
   - Dateien aus `%APPDATA%\Lumberjack\crashes\`

### Bekannte Probleme und Fixes

#### Problem: Speicher wächst mit TCP-Server
**Status**: ✅ Behoben in v1.0.1+
**Lösung**: Update auf neueste Version

Die folgenden Fixes sind implementiert:
- Socket-Cleanup bei Trennung
- Buffer-Overflow-Schutz
- Connection-Limits
- Automatische Timeouts

#### Problem: HTTP-Polling verursacht Speicherleck
**Status**: ✅ Behoben in v1.0.1+
**Lösung**: Update auf neueste Version

Die folgenden Fixes sind implementiert:
- Deduplizierungs-Set wird getrimmt
- Response-Größen-Limit
- Request-Timeouts
- Speicher-Überwachung

#### Problem: Anwendung beendet sich still
**Status**: ✅ Behoben in v1.0.1+
**Features**: Comprehensive logging, crash dumps, signal handlers

---

# Troubleshooting Memory and Resource Issues

## Overview

If Lumberjack continues to have issues that could be related to memory or resources, this guide will help diagnose and resolve them.

## Symptoms of Memory Problems

### 1. Application Slows Down Over Time
- UI becomes sluggish
- Scrolling becomes jerky
- Filters take longer

**Possible Cause**: Memory leak or too many log entries in memory

### 2. Application Crashes or Exits Unexpectedly
- Window closes suddenly
- "Out of Memory" errors
- Application becomes unresponsive (hangs)

**Possible Cause**: Memory exhaustion

### 3. High Memory Usage
- Windows Task Manager shows high RAM usage
- Memory continuously increases
- Other applications slow down

**Possible Cause**: Memory leak or large log files

### 4. Network Functions Cause Problems
- TCP connections accumulate
- HTTP polling consumes lots of memory
- Connections not properly closed

**Possible Cause**: Network resource leak

## Quick Diagnosis

### Step 1: Check Logs

The application writes detailed logs:

**Windows**: 
```
%APPDATA%\Lumberjack\logs\main.log
```

**macOS**: 
```
~/Library/Logs/Lumberjack/main.log
```

**Linux**: 
```
~/.local/share/Lumberjack/logs/main.log
```

**What to look for:**
- `[tcp]` entries - TCP connection issues
- `[http:poll]` entries - HTTP polling issues
- `Buffer overflow` - Buffer overflow protection activated
- `Trimmed seen Set` - Deduplication memory protection activated
- `Memory` or `OOM` - Memory problems

### Step 2: Check Crash Dumps

Native crashes generate crash dumps:

**Windows**: 
```
%APPDATA%\Lumberjack\crashes\
```

**macOS/Linux**: 
```
~/Library/Application Support/Lumberjack/crashes/
```

If crash dumps exist, this indicates native crashes (V8, GPU, etc.).

### Step 3: Monitor Resource Usage

#### Windows Task Manager
1. Press `Ctrl+Shift+Esc`
2. "Details" tab
3. Look for "Lumberjack.exe"
4. Observe memory and CPU usage

**Normal**: 50-200 MB with moderate use
**Problematic**: >500 MB or continuous growth

#### macOS Activity Monitor
1. `Cmd+Space` → "Activity Monitor"
2. Search for "Lumberjack"
3. Observe memory and CPU

#### Linux (htop/top)
```bash
htop
# Filter for "lumberjack" (F4)
```

### Step 4: Run Diagnostic Script

The repository includes a diagnostic script:

```bash
npm run diagnose:memory
```

This checks:
- ✅ Log files for errors
- ✅ Crash dumps
- ✅ Active network connections
- ✅ Memory trends
- ✅ Known problem patterns

## Detailed Diagnosis

### Check Network Functions

If using TCP server or HTTP polling:

#### 1. Check Active Connections

Logs show active TCP connections:
```
[tcp] Socket connected: 192.168.1.100:54321 (active: 5)
[tcp] Socket cleaned up: 192.168.1.100:54321 (active: 4)
```

**Normal**: Connections are closed (`cleaned up`)
**Problem**: Many `connected` but no `cleaned up` entries

#### 2. Check HTTP Polling Memory

Logs show when deduplication memory is trimmed:
```
[http:poll] Trimmed seen Set to 5000 entries (was 10001)
```

**Normal**: Occasional trimming
**Problem**: Very frequent trimming (every minute) - indicates many unique entries

#### 3. Check Buffer Overflows

Warning on buffer overflow:
```
[tcp] Buffer overflow on 192.168.1.100:54321, dropping oldest data
```

**Normal**: Rare or never
**Problem**: Frequent - indicates clients sending too much data

### Identify Memory Leaks

#### 1. Create Baseline
1. Start application fresh
2. Note memory usage (e.g., 100 MB)
3. Use normally (1 hour)
4. Check memory usage again

**Normal**: Rises to 150-200 MB, then stable
**Problem**: Continuous growth (100 → 200 → 300 → 400 MB)

#### 2. Observe Memory Growth Over Time

Note memory usage every 10 minutes:
```
Time    Memory
10:00   120 MB
10:10   125 MB
10:20   128 MB
10:30   130 MB
10:40   132 MB
10:50   133 MB  ← Stabilizes
11:00   133 MB
```

**Normal**: Grows initially, then stabilizes
**Problem**: Continuous growth without plateau

### Check System Resources

#### 1. Available Memory
Ensure enough RAM is available:

**Windows**: Task Manager → Performance → Memory
**macOS**: Activity Monitor → Memory
**Linux**: `free -h`

**Recommended**: At least 2 GB free RAM

#### 2. Disk Space
Log files require disk space:

**Windows**: 
```cmd
dir %APPDATA%\Lumberjack
```

**macOS/Linux**: 
```bash
du -sh ~/Library/Logs/Lumberjack
```

**Normal**: <100 MB for logs
**Problem**: >1 GB - old logs can be deleted

#### 3. Open Files / File Descriptors

With many TCP connections:

**Linux**: 
```bash
lsof -p $(pgrep -f lumberjack) | wc -l
```

**Normal**: <1000
**Problem**: >5000 - indicates unclosed files/sockets

## Solutions

### Solution 1: Restart Application

Simplest solution for temporary issues:
1. Completely quit Lumberjack
2. Check Task Manager - end all processes
3. Restart

### Solution 2: Delete Old Logs

Log files can become large:

**Windows**: 
```cmd
del %APPDATA%\Lumberjack\logs\*.old
```

**macOS/Linux**: 
```bash
rm ~/Library/Logs/Lumberjack/*.old
```

### Solution 3: Adjust Network Limits

With many TCP connections or HTTP polling:

The application has built-in limits:
- **TCP connections**: Max 1000 concurrent
- **HTTP response**: Max 100 MB
- **TCP timeout**: 5 minutes
- **HTTP timeout**: 30 seconds

These are normally sufficient. If problems occur:
1. Reduce number of concurrent clients
2. Increase HTTP polling interval
3. Split large log files into smaller ones

### Solution 4: Handle Large Log Files

If loading very large log files (>100 MB):

**Option A**: Split file
```bash
# Linux/macOS
split -l 100000 huge.log chunk_

# Windows (PowerShell)
Get-Content huge.log -ReadCount 100000 | Set-Content chunk_$count.log
```

**Option B**: Load only relevant parts
```bash
# Last 50000 lines
tail -n 50000 huge.log > recent.log
```

### Solution 5: Optimize Filters

Complex filters can be slow:

**Inefficient**: Many nested ORs
```
term1|term2|term3|term4|term5|term6|term7|term8
```

**Better**: More specific filters
```
error&service
```

### Solution 6: Clear Browser Cache

The UI uses Service Workers for caching:

1. Open settings
2. "Clear cache" (if available)
3. Or: Delete application data:
   - Windows: `%APPDATA%\Lumberjack\`
   - Delete `Cache\` and `Service Worker\` subdirectories

## Preventive Measures

### 1. Check Logs Regularly
```bash
# Weekly log check
tail -n 1000 %APPDATA%\Lumberjack\logs\main.log
```

Watch for warnings:
- Buffer overflow
- Connection limit
- Trimmed seen Set

### 2. Monitor Network Connections

When using TCP server or HTTP polling:
- Active connections should not accumulate
- Logs should show cleanup messages
- Memory should stabilize

### 3. Monitor Memory Regularly

First month after deployment:
- Check memory usage weekly
- Document trends
- If continuous growth: Send logs to developers

### 4. Install Updates

Newer versions often include fixes:
- Check GitHub releases
- Read changelog
- Install important updates promptly

## Getting Help

### What to Provide

When reporting an issue:

1. **Logs** (last 500 lines):
   ```cmd
   # Windows
   powershell -Command "Get-Content %APPDATA%\Lumberjack\logs\main.log -Tail 500"
   ```

2. **System info**:
   - OS version (Windows 10/11, macOS Ventura, Ubuntu 22.04, etc.)
   - Total and available RAM
   - Lumberjack version

3. **Memory trend**:
   - Initial memory (e.g., 100 MB)
   - After 1 hour (e.g., 150 MB)
   - After 4 hours (e.g., 300 MB)

4. **Usage patterns**:
   - Large log files? How large?
   - TCP server active? How many connections?
   - HTTP polling active? How many URLs?
   - Filters active? Which ones?

5. **Crash dumps** (if present):
   - Files from `%APPDATA%\Lumberjack\crashes\`

### Known Issues and Fixes

#### Issue: Memory grows with TCP server
**Status**: ✅ Fixed in v1.0.1+
**Solution**: Update to latest version

The following fixes are implemented:
- Socket cleanup on disconnect
- Buffer overflow protection
- Connection limits
- Automatic timeouts

#### Issue: HTTP polling causes memory leak
**Status**: ✅ Fixed in v1.0.1+
**Solution**: Update to latest version

The following fixes are implemented:
- Deduplication Set trimming
- Response size limits
- Request timeouts
- Memory monitoring

#### Issue: Application exits silently
**Status**: ✅ Fixed in v1.0.1+
**Features**: Comprehensive logging, crash dumps, signal handlers
