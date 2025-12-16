# Settings Delta Logging

## Übersicht

Das Logfile zeigt nun detailliert auf, welche Einstellungen sich geändert haben. Beim Speichern von Einstellungen werden die Änderungen zwischen dem vorherigen Zustand (Alpha) und dem neuen Zustand (Delta) protokolliert.

## Implementierung

### Funktionsweise

1. **Alpha (Vorher)**: Der aktuelle Zustand der Einstellungen wird am Anfang des `settings:set` Handlers gespeichert
2. **Delta (Änderung)**: Nachdem alle Updates durchgeführt und gespeichert wurden, wird der neue Zustand erfasst
3. **Vergleich**: Alle Keys werden verglichen und Unterschiede werden protokolliert

### Log-Beispiele

#### Keine Änderungen
```
[settings] No configuration changes detected
```

#### Mit Änderungen
```
[settings] Configuration changed: {
  "changes": {
    "tcpPort": {
      "alpha": 4445,
      "delta": 4446
    },
    "locale": {
      "alpha": "de",
      "delta": "en"
    },
    "elasticUrl": {
      "alpha": "http://localhost:9200",
      "delta": "http://elastic.example.com:9200"
    }
  }
}
```

## Vorteile

- **Transparenz**: Benutzer und Administratoren können sehen, welche Konfigurationsänderungen vorgenommen wurden
- **Debugging**: Hilft bei der Fehlersuche, wenn Probleme nach Einstellungsänderungen auftreten
- **Audit-Trail**: Protokolliert alle Konfigurationsänderungen für Compliance und Dokumentation
- **Deep Comparison**: Funktioniert auch mit verschachtelten Objekten (z.B. windowBounds)

## Technische Details

### Implementierungsort
- Datei: `src/main/ipcHandlers.ts`
- Funktion: `"settings:set"` IPC Handler
- Zeilen: ~180-235

### Sensible Daten
- **elasticPassEnc**: Verschlüsselte Passwörter werden als `[encrypted]` geloggt (nicht im Klartext)
- Passwort-Updates werden protokolliert, aber nicht die tatsächlichen Werte

### Performance
- Die Implementierung nutzt JSON.stringify für Deep Comparison
- Minimal Performance-Impact, da nur bei Einstellungsänderungen ausgeführt
- Nur relevante Änderungen werden protokolliert

