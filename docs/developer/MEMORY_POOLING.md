# Speicherdiagnose für Log-Einträge

Lumberjack verwendet für Log-Einträge keinen Objektpool. Die Datenhaltung erfolgt über das [PagedLogRepository](../../src/store/paged/PagedLogRepository.ts); die virtuelle Liste lädt die benötigten Einträge nach. Frühere Pool-Trefferquoten beschreiben diesen Datenpfad nicht.

`window.ljDebug.memoryUsage()` schätzt die Größe der im Renderer verfügbaren Textfelder. Der Wert ist weder der gesamte Heap-Verbrauch noch die Größe der Datenbank. Für Messungen beim Filtern siehe [Live filter measurements](PERFORMANCE.md#live-filter-measurements).
