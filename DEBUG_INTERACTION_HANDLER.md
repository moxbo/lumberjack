# Debug-Guide: Nicht-reaktive Liste und Auswahl-Fehler

## Symptome
- Die Liste und das Auswählen von Einträgen funktioniert nicht mehr
- Nur das native Menü ist noch bedienbar
- Wahrscheinlich ein Event-Handling oder Focus-Management Problem

## Ursachenanalyse

### Mögliche Probleme

1. **CSS `pointer-events` Blockierungen**
   - `.overlay` hat `pointer-events: none` aber Kinder `.details` haben `pointer-events: auto`
   - Container mit absoluter Positionierung könnten Events blockieren

2. **Event-Delegation Fehler**
   - Virtualisierte Zeilen (`virtualItems.map`) könnten Events nicht korrekt erhalten
   - onClick/onContextMenu-Handler könnten nicht richtig auf den virtuellen Elementen angewendet sein

3. **Fokus-Management**
   - Die Liste mit `tabIndex={0}` muss fokussiert sein, um Keyboard-Events zu erhalten
   - onMouseDown-Handler könnten Fokus nicht korrekt setzen

4. **State-Update Race Conditions**
   - `toggleSelectIndex` ist asynchron und könnte nicht korrekt reagieren
   - `selected` Set könnte nicht richtig aktualisiert werden

## Implementierte Fixes

### 1. CSS-Fixes (styles.css)
✅ Hinzugefügt: `.overlay` Kommentar für Klarheit
✅ Hinzugefügt: `.details` mit `will-change: contents`
✅ Hinzugefügt: `.row` mit `pointer-events: auto`, `cursor: pointer`, `user-select: none`, `transition`

### 2. Event-Handler Fixes (App.tsx)
✅ Erweitert: `onListKeyDown` mit Home/End/Escape Support
✅ Verbessert: onClick/onContextMenu Handler mit Error-Catching
✅ Hinzugefügt: onMouseDown zu Liste für Fokus-Handling
✅ Hinzugefügt: `pointerEvents: "auto"` zum virtualisiertenContainer
✅ Verbessert: `toggleSelectIndex` mit robustem Error-Handling

### 3. Zusätzliche Verbesserungen
✅ Hinzugefügt: `tabIndex={-1}` zu virtuellen Zeilen für besseres Tab-Management
✅ Hinzugefügt: Try-Catch Blöcke in allen Handlern

## Testing-Schritte

1. Baue das Projekt: `npm run prebuild && npm run build:renderer`
2. Starten Sie die App: `npm run dev` oder `npm start`
3. Laden Sie einige Log-Dateien
4. Versuchen Sie:
   - Auf Einträge zu klicken
   - Mit Shift+Click mehrere Einträge zu wählen
   - Mit Ctrl/Cmd+Click einzelne Einträge hinzuzufügen
   - Mit Pfeiltasten zu navigieren
   - Mit Escape die Auswahl zu löschen
   - Mit Home/End ans Anfang/Ende zu springen
   - Rechtsklick für Kontextmenü

## Browser DevTools Debugging

### Wenn Problem weiterhin besteht:

1. Öffne DevTools (F12)
2. Suche nach Event-Listenern auf der Liste:
   ```javascript
   getEventListeners(document.querySelector('.list'))
   ```

3. Überprüfe die CSS `pointer-events`:
   ```javascript
   getComputedStyle(document.querySelector('.row')).pointerEvents
   getComputedStyle(document.querySelector('.overlay')).pointerEvents
   ```

4. Überprüfe Fokus:
   ```javascript
   document.activeElement
   document.querySelector('.list') === document.activeElement
   ```

5. Teste Click-Events manuell:
   ```javascript
   document.querySelector('.row').click()
   document.querySelector('.row').dispatchEvent(new MouseEvent('click', {bubbles: true}))
   ```

## Weitere Überprüfungen

- [ ] Überprüfe Browser-Konsole auf Fehler
- [ ] Überprüfe electron-log für Fehler im Main-Process
- [ ] Überprüfe ob Modal-Dialoge (.modal-backdrop) mit hohem z-index die UI überlagern
- [ ] Überprüfe ob Ghost-Element (invisible overlay) die Interaktion blockiert
- [ ] Überprüfe Performance mit `npm run dev` vs `npm start`

## Relevante Dateien
- `src/main/styles.css` - CSS-Styling
- `src/renderer/App.tsx` - React-Komponente mit Event-Handlern
- `src/renderer/LogRow.tsx` - Log-Row-Komponente

