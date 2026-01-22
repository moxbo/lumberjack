# Memory Pooling für Log-Einträge

## Übersicht

Lumberjack verwendet **Object Pooling** um den Garbage Collector (GC) Druck bei 100k+ Log-Einträgen zu reduzieren. Dies ist besonders wichtig für:

- **TCP-Streaming**: Kontinuierlicher Datenstrom über längere Zeit
- **Elasticsearch-Batches**: Tausende Logs auf einmal laden
- **Log-Rotation**: Alte Logs entfernen, neue hinzufügen

## Funktionsweise

### Ohne Pool (vorher)
```
Eingehende Logs → Neue Objekte erstellen → GC muss aufräumen
                                               ↓
                                        UI-Freezes möglich
```

### Mit Pool (jetzt)
```
Eingehende Logs → Objekte aus Pool holen → Pool füllen wenn Logs entfernt werden
                         ↓                              ↓
                  Weniger Allokationen          Weniger GC-Druck
```

## Implementierung

### Pool-Dateien
- `src/store/RendererLogEntryPool.ts` - Pool für den Renderer-Prozess
- `src/services/LogEntryPool.ts` - Pool für den Main-Prozess

### Integration
Der Pool ist in `useEntryManagement.ts` integriert:

1. **Beim Trimmen** (wenn zu viele Logs): Entfernte Einträge werden dem Pool zurückgegeben
2. **Beim Löschen aller Logs**: Alle Einträge werden recycliert

## Konfiguration

```typescript
const pool = getRendererLogEntryPool({
  maxSize: 50_000,      // Max. Objekte im Pool
  initialSize: 2_000,   // Vorallokierte Objekte
  enableLogging: false, // Debug-Logging
});
```

## Debug-Funktionen

In den DevTools (F12) verfügbar:

```javascript
// Pool-Statistiken anzeigen
window.ljDebug.poolStats()

// Memory-Nutzung schätzen
window.ljDebug.memoryUsage()
```

## Statistiken

| Metrik | Beschreibung |
|--------|--------------|
| `available` | Aktuell im Pool verfügbare Objekte |
| `totalCreated` | Insgesamt erstellte Objekte |
| `reused` | Aus dem Pool wiederverwendete Objekte |
| `returned` | In den Pool zurückgegebene Objekte |
| `hitRate` | Wiederverwendungsrate (höher = besser) |

## Performance-Verbesserungen

Test mit 100k Logs (Trimming-Simulation):
- **Hit-Rate**: ~45% (fast die Hälfte aller Objekte wiederverwendet)
- **Memory-Einsparung**: ~70% bei kurzlebigen Objekten

## Wann greift der Pool?

1. **Automatisch beim Trimmen**: Wenn die Anzahl der Logs `TRIM_THRESHOLD_ENTRIES` (950k) überschreitet
2. **Beim Clear**: Wenn alle Logs gelöscht werden (Menü → Ansicht → Logs löschen)

## Hinweise

- Der Pool hat eine maximale Größe (`maxSize`), um nicht unbegrenzt Speicher zu belegen
- Logs die länger im Speicher bleiben (nicht getrimmt werden), blockieren den Pool nicht
- Der Pool ist ein Singleton pro Prozess
