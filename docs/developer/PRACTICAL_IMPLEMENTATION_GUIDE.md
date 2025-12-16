# Praktischer Implementierungs-Guide
## Schritt-für-Schritt Optimierung der Lumberjack Anwendung

---

## Phase 1: Dynamische Batch-Verzögerung (30 Min)

### Problem
Die feste `BATCH_SEND_DELAY_MS = 8ms` führt zu Event-Loop-Stauer bei vielen gleichzeitigen Logs.

### Lösung

**Datei:** `src/main/main.ts`

Ersetze die statische Konstante mit adaptiver Logik:

```typescript
// ============= VORHER =============
const BATCH_SEND_DELAY_MS = 8;

function sendBatchesAsyncTo(
  wc: any,
  channel: string,
  batches: LogEntry[][],
): void {
  if (!batches || batches.length === 0) return;
  
  batches.forEach((batch, idx) => {
    setTimeout(() => {
      // ... sende batch
    }, idx * BATCH_SEND_DELAY_MS); // Immer 8ms
  });
}

// ============= NACHHER =============

// Track für aktive Sender
const activeBatchSends = new Map<string, number>();

function calculateAdaptiveBatchDelay(
  channel: string,
  totalBatches: number,
  activeSends: number
): number {
  // Je mehr aktive Sender, desto höher die Verzögerung
  const combinedLoad = (activeSends || 0) + (activeBatchSends.get(channel) || 0);
  
  if (combinedLoad > 20) return 50;    // Kritische Überlastung
  if (combinedLoad > 15) return 30;    // Stark belastet
  if (combinedLoad > 10) return 15;    // Leicht belastet
  if (combinedLoad > 5)  return 10;    // Normal
  return 8;                            // Optimal
}

function sendBatchesAsyncTo(
  wc: any,
  channel: string,
  batches: LogEntry[][],
): void {
  if (!batches || batches.length === 0) return;

  const batchCount = batches.length;
  const activeSends = activeBatchSends.get(channel) || 0;
  activeBatchSends.set(channel, activeSends + 1);

  let accumulatedDelay = 0;
  
  batches.forEach((batch, idx) => {
    const delay = calculateAdaptiveBatchDelay(channel, batchCount, activeSends);
    accumulatedDelay += delay;
    
    setTimeout(() => {
      try {
        if (!wc || wc.isDestroyed?.()) return;
        
        wc.send(channel, batch);
        batchSendStats.total++;
        batchSendStats.lastSendTime = Date.now();
        
        if (batchSendStats.total % 10 === 0) {
          try {
            log.debug('[batch-adaptive] send successful:', {
              idx,
              totalBatches: batchCount,
              delay,
              load: activeSends,
            });
          } catch {}
        }
      } catch (e) {
        batchSendStats.failed++;
      } finally {
        // Markiere send als abgeschlossen
        if (idx === batchCount - 1) {
          activeBatchSends.set(channel, Math.max(0, activeSends - 1));
        }
      }
    }, accumulatedDelay);
  });
}
```

### Testing
```bash
# Vor Änderung: Beobachte [freeze-diag] Logs
npm run dev

# Nach Änderung: Vergleiche Zahlen
# Suche nach "[batch-adaptive]" im Log
```

---

## Phase 2: Asynchrone Datei-I/O (45 Min)

### Problem
`writeEntriesToFile()` blockiert synchron den Main Thread.

### Lösung

**Datei:** Neue Datei `src/main/AsyncFileWriter.ts`

```typescript
/**
 * AsyncFileWriter - Asynchrone Datei-Schreiboperationen
 * Verhindert Blockierung des Main Thread
 */

import * as fs from 'fs';
import log from 'electron-log/main';

export interface WriteTask {
  data: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class AsyncFileWriter {
  private writeQueue: WriteTask[] = [];
  private isWriting = false;
  private fileHandle: fs.promises.FileHandle | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Öffne Datei-Handle
   */
  async open(): Promise<void> {
    try {
      this.fileHandle = await fs.promises.open(this.filePath, 'a');
      log.info('[AsyncFileWriter] Datei geöffnet:', this.filePath);
    } catch (e) {
      log.error(
        '[AsyncFileWriter] Fehler beim Öffnen:',
        e instanceof Error ? e.message : String(e)
      );
      throw e;
    }
  }

  /**
   * Schreibe Daten (nicht-blockierend)
   */
  write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ data, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Verarbeite Schreib-Queue
   */
  private async processQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) return;
    
    this.isWriting = true;

    while (this.writeQueue.length > 0) {
      const task = this.writeQueue.shift();
      if (!task) break;

      try {
        if (!this.fileHandle) {
          await this.open();
        }

        if (this.fileHandle) {
          await this.fileHandle.write(task.data);
          task.resolve();
        }
      } catch (e) {
        task.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }

    this.isWriting = false;

    // Fortsetzung wenn während Schreiben neue Items hinzugefügt wurden
    if (this.writeQueue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Schließe Datei
   */
  async close(): Promise<void> {
    try {
      // Warte bis Queue leer ist
      await new Promise<void>((resolve) => {
        const checkQueue = setInterval(() => {
          if (this.writeQueue.length === 0 && !this.isWriting) {
            clearInterval(checkQueue);
            resolve();
          }
        }, 100);
      });

      if (this.fileHandle) {
        await this.fileHandle.close();
        this.fileHandle = null;
        log.info('[AsyncFileWriter] Datei geschlossen');
      }
    } catch (e) {
      log.error(
        '[AsyncFileWriter] Fehler beim Schließen:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  /**
   * Fülle alle ausstehenden Schreibvorgänge auf
   */
  async flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkFlush = setInterval(() => {
        if (this.writeQueue.length === 0 && !this.isWriting) {
          clearInterval(checkFlush);
          resolve();
        }
      }, 50);
    });
  }
}
```

**Datei:** `src/main/main.ts` - Update

```typescript
import { AsyncFileWriter } from './AsyncFileWriter';

// Ersetze
let logStream: fs.WriteStream | null = null;

// Mit
let asyncFileWriter: AsyncFileWriter | null = null;

function openLogStream(): void {
  try {
    const logPath = defaultLogFilePath();
    if (!logPath) return;

    asyncFileWriter = new AsyncFileWriter(logPath);
    void asyncFileWriter.open();
    log.info('[logging] AsyncFileWriter initialized:', logPath);
  } catch (e) {
    log.error(
      '[logging] Failed to open log stream:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function writeEntriesToFile(entries: LogEntry[]): Promise<void> {
  if (!asyncFileWriter) return;

  try {
    for (const entry of entries) {
      const line = JSON.stringify(entry) + '\n';
      await asyncFileWriter.write(line);
    }
  } catch (e) {
    log.error(
      '[logging] Write failed:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

function closeLogStream(): void {
  if (asyncFileWriter) {
    void asyncFileWriter.close();
    asyncFileWriter = null;
  }
}
```

### Testing
```typescript
// Schneller Test mit großem Batch
const entries = Array(1000).fill(null).map((_, i) => ({
  timestamp: Date.now(),
  level: 'INFO',
  message: `Test log ${i}`
}));

// Sollte NICHT blockieren
writeEntriesToFile(entries);
// App reagiert sofort
```

---

## Phase 3: Smart Buffer Management (1 Stunde)

### Problem
`MAX_PENDING_APPENDS = 5000` führt zu unbegrenztem Speicherwachstum.

### Lösung

**Datei:** Neue Datei `src/main/AdaptiveBuffer.ts`

```typescript
/**
 * AdaptiveBuffer - Intelligenter Buffer mit Backpressure
 * Passt Größe automatisch an verfügbaren RAM an
 */

import log from 'electron-log/main';
import os from 'os';
import type { LogEntry } from '../types/ipc';

export interface BufferStats {
  currentSize: number;
  maxSize: number;
  itemCount: number;
  backpressureActive: boolean;
  memoryUsage: NodeJS.MemoryUsage;
}

export class AdaptiveBuffer {
  private items: LogEntry[] = [];
  private maxSize: number = 5000;
  private baseMaxSize: number = 5000;
  private backpressureThreshold: number = 0.8; // 80%
  private backpressureActive: boolean = false;
  private lastMemoryWarning: number = 0;
  private memoryCheckInterval: NodeJS.Timeout | null = null;

  constructor(initialMaxSize: number = 5000) {
    this.baseMaxSize = initialMaxSize;
    this.maxSize = initialMaxSize;
    this.startMemoryMonitoring();
  }

  /**
   * Starte Speicher-Monitoring
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckInterval = setInterval(() => {
      const mem = process.memoryUsage();
      const heapPercent = mem.heapUsed / mem.heapLimit;

      // Passe Buffer-Größe basierend auf Speichernutzung an
      if (heapPercent > 0.85) {
        this.maxSize = Math.floor(this.maxSize * 0.7); // Reduziere um 30%
        log.warn('[AdaptiveBuffer] Speicher kritisch, Buffer verkleinert:', {
          heapPercent: (heapPercent * 100).toFixed(1),
          newMaxSize: this.maxSize,
        });
      } else if (heapPercent < 0.5 && this.maxSize < this.baseMaxSize) {
        this.maxSize = Math.min(
          this.maxSize * 1.2,
          this.baseMaxSize
        );
        log.info('[AdaptiveBuffer] Speicher OK, Buffer vergrößert:', {
          heapPercent: (heapPercent * 100).toFixed(1),
          newMaxSize: this.maxSize,
        });
      }
    }, 5000); // Check alle 5 Sekunden
  }

  /**
   * Kann Daten akzeptieren?
   */
  canAccept(): boolean {
    const fillRatio = this.items.length / this.maxSize;
    this.backpressureActive = fillRatio > this.backpressureThreshold;
    return !this.backpressureActive;
  }

  /**
   * Füge Einträge hinzu
   */
  add(entries: LogEntry[]): boolean {
    if (!this.canAccept()) {
      const now = Date.now();
      if (now - this.lastMemoryWarning > 5000) {
        log.warn('[AdaptiveBuffer] Backpressure aktiv, Einträge verworfen:', {
          requestedCount: entries.length,
          currentCount: this.items.length,
          maxSize: this.maxSize,
          fillRatio: (this.items.length / this.maxSize * 100).toFixed(1),
        });
        this.lastMemoryWarning = now;
      }
      return false;
    }

    // Wenn Buffer fast voll, begenze Hinzufügung
    if (this.items.length + entries.length > this.maxSize) {
      const room = this.maxSize - this.items.length;
      const toAdd = entries.slice(entries.length - room);
      this.items.push(...toAdd);
      return toAdd.length > 0;
    }

    this.items.push(...entries);
    return true;
  }

  /**
   * Hole alle Einträge und leere Buffer
   */
  flush(): LogEntry[] {
    const result = this.items;
    this.items = [];
    return result;
  }

  /**
   * Hole aktuelle Statistik
   */
  getStats(): BufferStats {
    return {
      currentSize: this.items.length,
      maxSize: this.maxSize,
      itemCount: this.items.length,
      backpressureActive: this.backpressureActive,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Aufräumen
   */
  destroy(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    this.items = [];
  }
}
```

**Datei:** `src/main/main.ts` - Update

```typescript
import { AdaptiveBuffer } from './AdaptiveBuffer';

// Ersetze
let pendingAppends: LogEntry[] = [];

// Mit
const adaptiveBuffer = new AdaptiveBuffer(5000);

// Beim Shutdown
app.on('quit', () => {
  try {
    adaptiveBuffer.destroy();
    // ...
  } catch (e) {
    // ...
  }
});

// Ersetze enqueueAppends
function enqueueAppends(entries: LogEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) return;
  
  if (!adaptiveBuffer.add(entries)) {
    try {
      log.warn('[buffer] Backpressure - entries dropped:', entries.length);
    } catch {}
  }
}

// Ersetze flushPendingAppends
function flushPendingAppends(): void {
  if (!isRendererReady()) return;
  
  const entries = adaptiveBuffer.flush();
  if (entries.length === 0) return;
  
  const wc = mainWindow?.webContents;
  if (!wc) {
    // Gib Einträge zurück in Buffer wenn Renderer nicht bereit
    adaptiveBuffer.add(entries);
    return;
  }

  try {
    const batches: LogEntry[][] = [];
    for (let i = 0; i < entries.length; i += MAX_BATCH_ENTRIES) {
      const slice = entries.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    sendBatchesAsyncTo(wc, 'logs:append', batches);
  } catch (e) {
    log.error('flushPendingAppends failed:', e);
    adaptiveBuffer.add(entries);
  }
}

// Optional: Periodisches Flushing
setInterval(() => {
  try {
    flushPendingAppends();
    
    // Log Statistiken alle 30 Sekunden
    const stats = adaptiveBuffer.getStats();
    log.debug('[buffer-stats]:', {
      current: stats.currentSize,
      max: stats.maxSize,
      fillRatio: (stats.currentSize / stats.maxSize * 100).toFixed(1),
      backpressure: stats.backpressureActive,
    });
  } catch {}
}, 30000);
```

---

## Phase 4: Renderer-Virtualisierung (2 Stunden)

### Problem
Große Log-Listen mit 10.000+ Einträgen verursachen massive DOM-Bloat.

### Lösung

**Datei:** `src/renderer/App.tsx` - Update

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useCallback } from 'preact/hooks';

export function LogViewer() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Virtualisiere die Liste
  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 40, []), // ~40px pro Zeile
    overscan: 15, // Render 15 extra Zeilen über/unter sichtbar
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      style={{
        height: '600px',
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <LogRow entry={logs[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Vorher:** 1.000 Log-Zeilen → 1.000 DOM Nodes  
**Nachher:** 1.000 Log-Zeilen → ~30 DOM Nodes sichtbar ✅

---

## Phase 5: IPC-Bandbreitenkontrolle (1 Stunde)

### Problem
Zu viele gleichzeitige IPC-Nachrichten können die Kommunikation sättigen.

### Lösung

**Datei:** Neue Datei `src/main/IpcBandwidthThrottler.ts`

```typescript
/**
 * IpcBandwidthThrottler - Kontrolliert IPC-Durchsatz
 * Verhindert Übersättigung
 */

import log from 'electron-log/main';
import type { LogEntry } from '../types/ipc';

export class IpcBandwidthThrottler {
  private queue: Array<{ batch: LogEntry[]; channel: string }> = [];
  private isProcessing = false;
  private lastSendTime = 0;
  private minIntervalMs = 10; // Minimum 10ms zwischen Sends
  private maxBatchSize = 1000;
  private stats = {
    sent: 0,
    queued: 0,
    dropped: 0,
  };

  /**
   * Sende Batch mit Drosselung
   */
  async send(
    wc: any,
    channel: string,
    batch: LogEntry[]
  ): Promise<boolean> {
    if (!wc || wc.isDestroyed?.()) {
      return false;
    }

    this.queue.push({ batch, channel });
    this.processQueue(wc);
    return true;
  }

  /**
   * Verarbeite Queue mit Drosselung
   */
  private async processQueue(wc: any): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && !wc.isDestroyed?.()) {
      const { batch, channel } = this.queue.shift()!;

      // Warte bis Minimum-Intervall abgelaufen ist
      const timeSinceLastSend = Date.now() - this.lastSendTime;
      if (timeSinceLastSend < this.minIntervalMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.minIntervalMs - timeSinceLastSend)
        );
      }

      try {
        wc.send(channel, batch);
        this.lastSendTime = Date.now();
        this.stats.sent++;

        // Alle 50 Sends loggen
        if (this.stats.sent % 50 === 0) {
          log.debug('[ipc-throttler] Stats:', this.stats);
        }
      } catch (e) {
        log.error('[ipc-throttler] Send failed:', e);
        this.stats.dropped++;
      }
    }

    this.isProcessing = false;
  }

  /**
   * Hole Statistiken
   */
  getStats() {
    return { ...this.stats, queuedItems: this.queue.length };
  }
}
```

---

## Monitoring & Diagnostik

### Performance Dashboard

**Datei:** `src/main/PerformanceMonitor.ts`

```typescript
/**
 * PerformanceMonitor - Zentrales Monitoring aller Performance-Metriken
 */

import log from 'electron-log/main';

export class PerformanceMonitor {
  private metrics = {
    ipc: { sent: 0, failed: 0, avgSize: 0 },
    memory: { peak: 0, current: 0 },
    cpu: { usage: 0 },
    buffer: { size: 0, maxSize: 0 },
  };

  /**
   * Logge Periodic Report
   */
  startReporting(intervalMs = 60000): void {
    setInterval(() => {
      const mem = process.memoryUsage();
      const report = {
        timestamp: new Date().toISOString(),
        memory: {
          heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
          heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`,
          external: `${(mem.external / 1024 / 1024).toFixed(1)}MB`,
        },
        uptime: `${(process.uptime() / 60).toFixed(1)}min`,
        ...this.metrics,
      };

      log.info('[PERF-REPORT]', report);
    }, intervalMs);
  }

  updateIpcStats(sent: number, failed: number, avgSize: number): void {
    this.metrics.ipc = { sent, failed, avgSize };
  }

  updateMemoryStats(): void {
    const mem = process.memoryUsage();
    this.metrics.memory.current = mem.heapUsed;
    this.metrics.memory.peak = Math.max(
      this.metrics.memory.peak,
      mem.heapUsed
    );
  }
}
```

---

## Implementierungs-Checkliste

```
Phase 1: Batch-Verzögerung
- [ ] Code in main.ts anpassen
- [ ] Testen mit Freeze Monitor
- [ ] Logs überprüfen

Phase 2: Async File I/O
- [ ] AsyncFileWriter.ts erstellen
- [ ] main.ts aktualisieren
- [ ] Stress-Test mit 100k Logs

Phase 3: Smart Buffer
- [ ] AdaptiveBuffer.ts erstellen
- [ ] main.ts aktualisieren
- [ ] Memory-Profiling durchführen

Phase 4: Renderer Virtualisierung
- [ ] App.tsx mit useVirtualizer
- [ ] LogRow-Komponente optimieren
- [ ] DOM-Size überprüfen

Phase 5: IPC Throttling
- [ ] IpcBandwidthThrottler.ts
- [ ] Integration in main.ts
- [ ] Durchsatz testen
```

---

## Erfolgs-Indikatoren

Nach jeder Phase überprüfen:

```bash
# Memory-Nutzung
ps aux | grep Lumberjack

# CPU-Auslastung
top -p $(pgrep -f "Lumberjack")

# Event Loop Lag (aus Logs)
grep "\[freeze-diag\]" ~/.config/Lumberjack/logs/*.log

# IPC Statistiken (aus Logs)
grep "\[ipc-throttler\]" ~/.config/Lumberjack/logs/*.log
```


