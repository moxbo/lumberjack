# 🆘 TROUBLESHOOTING & FAQ
## Häufige Probleme bei Optimierung und ihre Lösungen

---

## ⚠️ SICHERHEITSWARNUNGEN BEIM ERSTEN START

### macOS: "App ist beschädigt oder unvollständig"

**Symptom:**
> "Du kannst das Programm „Lumberjack" nicht öffnen, da es möglicherweise beschädigt oder unvollständig ist."

**Ursache:** macOS setzt bei Downloads aus dem Internet ein "Quarantine"-Attribut. Bei Apps ohne Apple-Notarisierung wird dieses nicht automatisch entfernt.

**Lösung (Terminal):**
```bash
# Für installierte App:
xattr -cr /Applications/Lumberjack.app

# Für DMG im Downloads-Ordner:
xattr -cr ~/Downloads/Lumberjack*.dmg

# Für ZIP im Downloads-Ordner:
xattr -cr ~/Downloads/Lumberjack*.zip
```

Nach dem Entfernen des Quarantine-Attributs kann die App normal geöffnet werden.

---

### macOS: "App kann nicht geöffnet werden"

**Symptom:**
> "Lumberjack" kann nicht geöffnet werden, da es von einem nicht verifizierten Entwickler stammt.

**Lösung:**

**Methode 1 - Rechtsklick (Empfohlen):**
1. Im Finder zur App navigieren (`/Applications/Lumberjack.app`)
2. **Rechtsklick** (oder Ctrl+Klick) auf die App
3. "Öffnen" auswählen
4. Im Dialog erneut "Öffnen" klicken
5. ✅ Die App startet und wird für zukünftige Starts freigeschaltet

**Methode 2 - Systemeinstellungen:**
1. Systemeinstellungen → Datenschutz & Sicherheit
2. Nach unten scrollen zu "Sicherheit"
3. "Lumberjack trotzdem öffnen" klicken
4. Mit Touch ID oder Passwort bestätigen

**Methode 3 - Terminal:**
```bash
xattr -cr /Applications/Lumberjack.app
```

---

### Windows: "Windows hat Ihren PC geschützt" (SmartScreen)

**Symptom:**
> Windows Defender SmartScreen hat den Start einer unbekannten App verhindert.

**Lösung:**
1. Im SmartScreen-Dialog auf **"Weitere Informationen"** klicken
2. Dann auf **"Trotzdem ausführen"** klicken
3. ✅ Die App startet

**Hinweis:** Diese Warnung erscheint nur beim ersten Start. Windows merkt sich die Entscheidung.

---

### Warum diese Warnungen?

Lumberjack ist **Open Source** und wird ohne kostenpflichtige Code-Signing-Zertifikate verteilt. Das bedeutet:

- ✅ Die App ist sicher und enthält keine Malware
- ✅ Der Quellcode ist auf GitHub einsehbar
- ⚠️ macOS/Windows können den Entwickler nicht verifizieren

**Für Entwickler:** Siehe [Code Signing Guide](../developer/CODE_SIGNING_GUIDE.md) für Informationen zur Signierung.

---

## 🔴 KRITISCHE FEHLER

### Problem: "Cannot read property 'length' of undefined"

**Symptom:**
```
TypeError: Cannot read property 'length' of undefined
at sendBatchesAsyncTo (main.ts:...)
```

**Ursache:** `batches` ist null oder undefined

**Lösung:**
```typescript
// VORHER: Fehler
const batches: LogEntry[][] = [];
sendBatchesAsyncTo(wc, 'logs:append', batches); // Kann undefined sein

// NACHHER: Sicher
function sendBatchesAsyncTo(
  wc: any,
  channel: string,
  batches: LogEntry[][],
): void {
  // Defensive Checks
  if (!batches || batches.length === 0) return;
  if (!Array.isArray(batches)) {
    log.error('[batch] batches is not array:', typeof batches);
    return;
  }
  // ... rest of code
}
```

**Prävention:**
- Immer `Array.isArray()` überprüfen
- Nullish coalescing nutzen: `batches ?? []`
- TypeScript strict mode aktivieren

---

### Problem: "Memory out of bounds" / App crasht mit Out-of-Memory

**Symptom:**
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed
JavaScript heap out of memory
```

**Ursache:** Buffer wächst unkontrolliert

**Lösung:**
```typescript
// Aktiviere Adaptive Buffer
import { AdaptiveBuffer } from './AdaptiveBuffer';

const buffer = new AdaptiveBuffer(5000);

// Check regelmäßig
setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed / mem.heapLimit > 0.85) {
    log.error('[critical] Heap usage critical');
    // Force cleanup
    global.gc?.(); // Wenn Node mit --expose-gc gestartet
  }
}, 5000);
```

**Sofort-Maßnahme:**
```bash
# Starte mit mehr Heap
node --max-old-space-size=4096 dist-main/main.cjs
```

---

### Problem: "IPC message lost" / Daten fehlen beim Renderer

**Symptom:**
```
[batch-adaptive] send successful: idx=5, totalBatches=50
[batch-adaptive] send successful: idx=6, totalBatches=50
# Batch 7 fehlt völlig
```

**Ursache:** WebContents zerstört während Batch-Versand

**Lösung:**
```typescript
function sendBatchesAsyncTo(
  wc: any,
  channel: string,
  batches: LogEntry[][],
): void {
  // CHECK VOR JEDEM SEND
  batches.forEach((batch, idx) => {
    setTimeout(() => {
      // Sicher überprüfen
      if (!wc) {
        log.warn('[batch] wc is null at idx', idx);
        return;
      }
      
      if (wc.isDestroyed?.()) {
        log.warn('[batch] wc destroyed at idx', idx);
        return;
      }
      
      // Jetzt sicher zu senden
      try {
        wc.send(channel, batch);
      } catch (e) {
        log.error('[batch] send failed:', e);
        // Optional: Retry oder Buffer
      }
    }, idx * delay);
  });
}
```

---

## 🟠 HÄUFIGE PROBLEME

### Problem: App startet langsam (>15 Sekunden)

**Checkliste:**
```
□ Liegt es am Main Thread?
  → Überprüfe: "main-loaded" Zeitstempel in Logs
  
□ Liegt es am Renderer?
  → Überprüfe: "renderer-ready" vs "main-loaded"
  
□ Liegt es am Asset Loading?
  → Überprüfe: Icon Loading Logs
  → Überprüfe: Vite Bundle Size
```

**Debugging-Tricks:**
```bash
# Verbose Logging aktivieren
LUMBERJACK_DEBUG=1 npm run dev

# Startup Profiler
node --prof dist-main/main.cjs
# Dann: node --prof-process isolate-*.log > profile.txt
```

**Quick Fixes:**
```typescript
// 1. Icon Loading defer
setImmediate(() => {
  loadIcon(); // Nicht sofort
});

// 2. Async Settings laden
app.whenReady().then(async () => {
  await settingsService.load(); // Nicht blocking
});

// 3. Lazy Module Loading
if (needsParsers) {
  const p = getParsers(); // Nur wenn nötig
}
```

---

### Problem: Memory wächst kontinuierlich (Leak?)

**Symptom:**
```
Start: 150MB
Nach 1h: 400MB
Nach 2h: 650MB (Crash imminent)
```

**Diagnose:**
```bash
# 1. Checke ob es ein Leak ist
scripts/detect-memory-leaks.ts

# 2. Heap Snapshot
node --inspect dist-main/main.cjs
# Chrome DevTools → Memory → Heap Snapshots

# 3. Überprüfe aktive Sockets
netstat -an | grep 9999 # TCP Server Port
```

**Häufige Ursachen & Fixes:**

**Ursache 1: TCP Sockets nicht geschlossen**
```typescript
// FALSCH: Socket bleibt aktiv
tcpServer.on('connection', (socket) => {
  socket.on('data', (data) => {
    // Daten verarbeiten
    // KEIN socket.destroy() oder socket.end()
  });
});

// RICHTIG: Socket cleanup
tcpServer.on('connection', (socket) => {
  const timeout = setTimeout(() => {
    socket.destroy();
  }, 5 * 60 * 1000); // 5 min timeout
  
  socket.on('data', (data) => {
    // ...
  });
  
  socket.on('end', () => clearTimeout(timeout));
  socket.on('error', () => socket.destroy());
});
```

**Ursache 2: Event Listener nicht entfernt**
```typescript
// FALSCH
emitter.on('data', callback);
// Listener wird nie entfernt

// RICHTIG
function onData(data) { /* ... */ }
emitter.on('data', onData);

// Später:
emitter.removeListener('data', onData);

// Oder mit once:
emitter.once('data', callback); // Nur einmal
```

**Ursache 3: Buffer zu groß**
```typescript
// FALSCH: Unbegrenztes Wachstum
let logBuffer = [];
while (hasData()) {
  logBuffer.push(getData()); // Kann Millionen werden
}

// RICHTIG: Mit Limits
const adaptiveBuffer = new AdaptiveBuffer(5000);
if (!adaptiveBuffer.add(entries)) {
  // Backpressure: DROP die Daten
  log.warn('Buffer full, dropping entries');
}
```

---

### Problem: UI friert ein beim Scrolling

**Symptom:**
```
[freeze-monitor] Potential main thread freeze detected: frozenMs=2000
```

**Ursache:** Event Loop blockiert

**Lösung:**

```typescript
// FALSCH: Blockiert Event Loop
for (const entry of 10000) {
  processEntry(entry); // Synchron für alle
}

// RICHTIG: Mit Chunking
async function processEntriesChunked(entries: LogEntry[]) {
  const chunkSize = 100;
  
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    chunk.forEach(processEntry);
    
    // Gib Event Loop eine Chance zu atmen
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

**Alternative: Worker Thread**
```typescript
// Verschiebe zu Worker
const worker = new Worker('process.worker.ts');
worker.postMessage({ entries });
worker.on('message', (result) => {
  // Ergebnis zurück
});
```

---

### Problem: Filter/Search ist langsam

**Symptom:**
```
Tippe "error" → 500ms Verzögerung bis Ergebnisse
```

**Ursache:** Such-Logik blockiert

**Lösung:**
```typescript
// FALSCH: Synchrone Suche
function filterLogs(entries: LogEntry[], query: string) {
  return entries.filter(e => 
    e.message?.includes(query)
  ); // Kann Sekunden dauern bei 100k Einträgen
}

// RICHTIG: Mit Web Worker
// In Renderer Process
import SearchWorker from './search.worker.ts';

const worker = new SearchWorker();

function search(query: string) {
  return new Promise((resolve) => {
    worker.postMessage({ entries, query });
    worker.onmessage = (e) => resolve(e.data);
  });
}

// In Worker
self.onmessage = (e) => {
  const { entries, query } = e.data;
  const results = entries.filter(e =>
    e.message?.includes(query)
  );
  self.postMessage(results);
};
```

---

### Problem: TCP Server bindet Port nicht

**Symptom:**
```
Error: listen EADDRINUSE :::9999
```

**Ursache:** Port bereits in Nutzung

**Lösung:**
```typescript
// RICHTIG: Mit Fallback-Ports
async function findAvailablePort(start = 9999): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.listen(port, () => {
          server.close();
          resolve();
        }).on('error', reject);
      });
      return port;
    } catch (e) {
      // Try next port
    }
  }
  throw new Error('No available port found');
}

const port = await findAvailablePort();
```

---

## 🟡 WARNUNGEN & EDGE CASES

### Warnung: "Backpressure active, entries dropped"

**Bedeutung:** Buffer ist voll, neue Einträge werden verworfen

**Ist das ein Problem?**
- ✅ Nein, wenn selten (< 1x pro Minute)
- ⚠️ Warnung, wenn regelmäßig (mehrmals pro Minute)
- ❌ Ja, wenn konstant

**Fix:**
```typescript
// Erhöhe Buffer bei häufigem Backpressure
const MAX_PENDING_APPENDS = 10000; // Statt 5000

// Oder implementiere besseren Flow Control
if (backpressureCount > 100) {
  // Reduziere Datenquellen
  networkService.setHttpPollInterval(5000); // Höher
}
```

---

### Warnung: "Circuit breaker open"

**Bedeutung:** Externe Service antwortet nicht, Circuit Breaker schützt App

**Auswirkung:** Keine HTTP/Elasticsearch Daten, aber App läuft weiter

**Ist das ein Problem?**
- ❌ Nein, wenn Service wieder antwortet (auto-recovery in 30sec)
- ⚠️ Warnung, wenn Service lange down ist

**Check:**
```bash
# Überprüfe Service
curl http://external-service:port/health

# Logs überprüfen
grep "circuit-breaker" ~/.config/Lumberjack/logs/*.log
```

---

### Edge Case: Gleichzeitige Window-Operations

**Problem:** Mehrere Fenster, parallele Log-Updates

**Lösung:**
```typescript
// Nutze Window-spezifische Buffer
const pendingAppendsByWindow = new Map<number, LogEntry[]>();

function enqueueAppendsFor(winId: number, entries: LogEntry[]): void {
  const list = pendingAppendsByWindow.get(winId) || [];
  list.push(...entries);
  pendingAppendsByWindow.set(winId, list);
}

// Flush per Window
function flushPendingAppendsFor(win: BrowserWindow): void {
  const buf = pendingAppendsByWindow.get(win.id);
  if (!buf?.length) return;
  
  const wc = win.webContents;
  const batches: LogEntry[][] = [];
  for (let i = 0; i < buf.length; i += MAX_BATCH_ENTRIES) {
    batches.push(buf.slice(i, i + MAX_BATCH_ENTRIES));
  }
  
  sendBatchesAsyncTo(wc, 'logs:append', batches);
  pendingAppendsByWindow.delete(win.id);
}
```

---

## 📝 Debug-Tipps

### Enable Debug Logging
```bash
LUMBERJACK_DEBUG=1 npm run dev
```

### Alle [batch-adaptive] Logs sehen
```bash
grep "\[batch-adaptive\]" ~/.config/Lumberjack/logs/*.log
```

### Memory Timeline
```bash
while true; do
  ps aux | grep Lumberjack | grep -v grep | awk '{print $6}' >> mem.log
  sleep 5
done

# Plot: gnuplot or Excel
```

### CPU Profiler
```bash
node --prof dist-main/main.cjs
node --prof-process isolate-*.log > profile.txt
cat profile.txt
```

---

## 🎯 Checklist: Vor Production Deployment

```
Performance
□ Startup < 5 Sekunden
□ Memory < 200MB bei 50k Logs
□ CPU < 30% bei normalen Operationen
□ Event Loop Lag < 50ms
□ Scroll smooth (>45 FPS)

Stabilität
□ Keine Crashes in 24h Testing
□ TCP/HTTP nicht-blockierend
□ Graceful Error Handling
□ Log Rotation funktioniert

Memory Leaks
□ Kein kontinuierliches Wachstum
□ Sockets werden geschlossen
□ Event Listener werden entfernt
□ Worker Threads terminieren

Edge Cases
□ Mehrere Fenster parallel
□ Schnelle Datenquellen
□ Offline/Netzwerkfehler
□ Große Dateien (>500MB)

Testing
□ Alle Tests grün
□ Keine TypeScript Fehler
□ ESLint/Prettier OK
□ Chrome DevTools funktioniert
```

---

## 📞 Support

### Logs durchsuchen
```bash
# Finde Fehler
grep ERROR ~/.config/Lumberjack/logs/*.log

# Finde Performance-Probleme
grep "\[freeze-monitor\]\|\[batch-adaptive\]\|\[memory\]" ~/.config/Lumberjack/logs/*.log

# Zeitbereich
grep "2025-11-12" ~/.config/Lumberjack/logs/*.log
```

### Externe Ressourcen
- [Electron Debugging](https://www.electronjs.org/docs/tutorial/debugging-main-process)
- [Node.js Profiling](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Chrome DevTools Tips](https://developer.chrome.com/docs/devtools/memory-problems/)
