# Fix für UI-Einfrieren ("Keine Rückmeldung") bei HTTP Polling

## Problem

Die Anwendung reagiert zeitweise nicht und zeigt "Keine Rückmeldung" an, wenn große Datenmengen per HTTP-Polling geladen werden.

## Ursache

1. **Große Batches blockieren den UI-Thread** - Bei HTTP-Polling werden oft große Mengen an Log-Einträgen auf einmal verarbeitet
2. **Synchrone Verarbeitung ohne Yielding** - Der Event Loop hat keine Zeit für UI-Updates
3. **Zu große IPC-Batches** - Der Renderer wird mit zu vielen Daten auf einmal überflutet

## Lösung

### 1. HTTP Batch-Größe reduziert (NetworkService.ts)

```typescript
// Vorher:
private static readonly HTTP_BATCH_SIZE = 500;
private static readonly HTTP_BATCH_INTERVAL_MS = 50;

// Nachher:
private static readonly HTTP_BATCH_SIZE = 100;
private static readonly HTTP_BATCH_INTERVAL_MS = 16; // Ein Frame bei 60fps
```

### 2. Event Loop Yielding bei HTTP-Verarbeitung (NetworkService.ts)

Die `tick()`-Funktion im HTTP-Poller wurde angepasst, um zwischen aufwendigen Operationen dem Event Loop Zeit zu geben:

```typescript
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const tick = async (): Promise<void> => {
  await yieldToEventLoop(); // Vor dem Parsen
  const entries = parse(...);
  await yieldToEventLoop(); // Nach dem Parsen
  
  // Chunked Verarbeitung für große Batches
  if (fresh.length > 200) {
    for (let i = 0; i < fresh.length; i += 100) {
      this.queueHttpEntries(chunk);
      await yieldToEventLoop();
    }
  }
};
```

### 3. IPC Batch-Größe im Main-Prozess reduziert (constants.ts)

```typescript
// Vorher:
export const MAX_BATCH_ENTRIES = 200;

// Nachher:
export const MAX_BATCH_ENTRIES = 100;
```

### 4. Renderer IPC-Queue Verarbeitung optimiert (App.tsx)

```typescript
// Vorher:
const IPC_BATCH_SIZE = 5000;
const IPC_PROCESS_INTERVAL = 50;

// Nachher:
const IPC_BATCH_SIZE = 1000;
const IPC_PROCESS_INTERVAL = 16;
```

### 5. requestIdleCallback für Queue-Verarbeitung (App.tsx)

Die IPC-Queue wird jetzt mit `requestIdleCallback` verarbeitet, wenn verfügbar:

```typescript
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(
    () => processIpcQueue(),
    { timeout: IPC_PROCESS_INTERVAL * 3 }
  );
} else {
  setTimeout(() => processIpcQueue(), IPC_PROCESS_INTERVAL);
}
```

### 6. Schwellenwert für Queue-basierte Verarbeitung reduziert (App.tsx)

```typescript
// Vorher: Batches <= 500 werden direkt verarbeitet
// Nachher: Batches <= 200 werden direkt verarbeitet
// Größere Batches gehen in die Queue für kontrollierte Verarbeitung
```

## Auswirkungen

- ✅ Kleinere, häufigere IPC-Sendungen
- ✅ Event Loop hat Zeit für UI-Rendering
- ✅ requestIdleCallback nutzt freie CPU-Zeit optimal
- ✅ Chunked Processing verhindert lange Blockaden
- ✅ Anwendung bleibt responsiv auch bei großen Datenmengen

## Datum

Dezember 2025

---

## Nachträglicher Fix: "Queue cleared" Error Spam & Performance (16. Dezember 2025)

### Problem
1. Das Log wurde durchgehend mit `[error] Async write failed: Queue cleared` Meldungen gefüllt
2. Die Anwendung lief nicht performant

### Ursache
Bei der Log-Rotation (`rotateIfNeeded()`) wurde `closeLogStream()` aufgerufen, was wiederum `clearQueue()` im `AsyncFileWriter` aufrief. **Kritisch war, dass bei jedem einzelnen Log-Eintrag `rotateIfNeeded()` aufgerufen wurde** - das bedeutete:

- Tausende unnötige Rotation-Checks pro Sekunde
- Bei jeder Rotation wurden alle ausstehenden Schreibvorgänge als Fehler verworfen
- Der Error-Handler wurde für jede verworfene Promise aufgerufen → Massiver Error-Spam
- Ständiges Neuerstellen des AsyncFileWriters

### Lösung

#### 1. **writeEntriesToFile() optimiert** - Batch-Verarbeitung statt Einzelschreibvorgänge

```typescript
// Vorher: Für JEDEN Eintrag einzeln
for (const e of entries) {
  const line = JSON.stringify(e) + "\n";
  rotateIfNeeded(line.length);  // Bei JEDEM Eintrag!
  asyncFileWriter.write(line);  // Einzelne Writes
}

// Nachher: Einmal für den gesamten Batch
const lines: string[] = [];
let totalBytes = 0;
for (const e of entries) {
  const line = JSON.stringify(e) + "\n";
  lines.push(line);
  totalBytes += line.length;
}
rotateIfNeeded(totalBytes);  // Nur EINMAL
asyncFileWriter.write(lines.join(""));  // Batch-Write
```

#### 2. **AsyncFileWriter.clearQueue() angepasst**
- Ausstehende Schreibvorgänge werden jetzt still aufgelöst (`resolve()`) statt abgelehnt (`reject()`)
- Log-Level von `warn` auf `debug` geändert
- Löschen während der Rotation ist erwartetes Verhalten, kein Fehlerzustand

#### 3. **closeLogStream() angepasst**
- `clearQueue()` wird nicht mehr explizit aufgerufen
- `asyncFileWriter` Referenz wird einfach freigegeben

### Performance-Verbesserungen

| Metrik | Vorher | Nachher |
|--------|--------|---------|
| `rotateIfNeeded()` Aufrufe/Batch | N (Einträge) | 1 |
| File-System Writes/Batch | N | 1 |
| Error-Spam bei Rotation | Tausende | 0 |

