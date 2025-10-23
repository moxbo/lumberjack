# MDC Filter Implementation

## Overview

The MDC (Mapped Diagnostic Context) filter functionality is **fully implemented and operational**. This document describes the architecture, data flow, and key behaviors.

## Architecture

### Core Components

1. **LoggingStore** (`src/store/loggingStore.js`)
   - Receives log events and attaches MDC data via `computeMdcFromRaw()`
   - Notifies listeners via `loggingEventsAdded` and `loggingStoreReset` events
   - Extracts MDC keys from raw log JSON, excluding reserved standard fields

2. **MDCListener** (`src/store/mdcListener.js`)
   - Maintains `keys: Map<string, Set<string>>` structure
   - Listens to LoggingStore events
   - Extracts and accumulates MDC keys/values from incoming events
   - Provides sorted key and value lists for UI suggestions
   - Emits change events only when keys or values change

3. **DiagnosticContextFilter** (`src/store/dcFilter.js`)
   - Manages filter entries (key, value, active state)
   - Provides methods: `addMdcEntry`, `activateMdcEntry`, `deactivateMdcEntry`, `removeMdcEntry`, `reset`
   - Returns filter entries via `getDcEntries()`
   - Emits `onChange` events when filter state changes
   - Implements matching logic for log filtering

4. **DCFilterPanel** (`src/DCFilterPanel.jsx`)
   - UI component for MDC filter management
   - ComboBox for key selection (populated from MDCListener)
   - Text field for value input (supports pipe-separated values)
   - Read-only table displaying filter entries
   - Context menu for multi-select operations
   - F2 dialog for value suggestions

## Data Flow

```
Main Process
  │
  ├─► IPC: logs:append (log events)
  │
  └─► Renderer Process
       │
       ├─► LoggingStore.addEvents()
       │    ├─► Attaches MDC to each event
       │    └─► Notifies: loggingEventsAdded
       │
       ├─► MDCListener (listener)
       │    ├─► Extracts MDC keys/values
       │    ├─► Updates keys Map
       │    └─► Emits: onChange (if changed)
       │
       └─► DCFilterPanel
            ├─► Updates ComboBox keys (from MDCListener)
            └─► Table unchanged (only on filter state change)
```

## Key Behaviors

### 1. Suggestion Updates (Keys/Values)

**Trigger:** New log events arrive via `logs:append`

**Effect:**
- MDCListener extracts MDC keys/values
- ComboBox key list updates
- F2 value suggestions update
- **Table does NOT update** (filter state unchanged)

**Implementation:**
```javascript
// DCFilterPanel.jsx, lines 30-44
useEffect(() => {
  const off1 = MDCListener.onChange(() => setKeys(MDCListener.getSortedKeys()));
  const off2 = LoggingStore.addLoggingStoreListener({
    loggingEventsAdded: () => setKeys(MDCListener.getSortedKeys()),
    loggingStoreReset: () => {
      setKeys([]);
      setSelectedKey('');
    },
  });
  // ... cleanup
}, []);
```

### 2. Filter State Updates (Table)

**Trigger:** User actions (Add/Remove/Activate/Deactivate/Reset)

**Effect:**
- DiagnosticContextFilter emits `onChange`
- Table re-renders with updated entries
- **Suggestions do NOT update** (MDC data unchanged)

**Implementation:**
```javascript
// DCFilterPanel.jsx, lines 47-55
useEffect(() => {
  const off = DiagnosticContextFilter.onChange(() => {
    setRows(DiagnosticContextFilter.getDcEntries());
    setEnabled(DiagnosticContextFilter.isEnabled());
  });
  // ... initial state
}, []);
```

### 3. Add Operation

**Behavior:**
- Reads key from ComboBox and value from text field
- Supports pipe-separated values: `value1|value2|value3`
- Empty value creates wildcard entry (matches any value for that key)
- Clears **only** the value field after add
- Table updates to show new entries

**Implementation:**
```javascript
// DCFilterPanel.jsx, lines 57-69
function onAdd() {
  const key = String(selectedKey || '').trim();
  if (!key) return;
  const raw = String(val ?? '');
  const parts = raw.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    DiagnosticContextFilter.addMdcEntry(key, '');
  } else {
    for (const p of parts) DiagnosticContextFilter.addMdcEntry(key, p);
  }
  setVal('');
}
```

### 4. F2 Value Picker

**Trigger:** F2 key in value field, or "Werte…" button

**Behavior:**
- Opens dialog showing known values for selected key
- Values populated from MDCListener.getSortedValues(key)
- Selecting a value fills text field and triggers Add

**Implementation:**
```javascript
// DCFilterPanel.jsx, lines 135-155
function onValueKeyDown(e) {
  if (e.key === 'F2') {
    e.preventDefault();
    const k = String(selectedKey || '').trim();
    if (!k) return;
    const vals = MDCListener.getSortedValues(k);
    setValues(vals);
    setShowValues(true);
  }
}

function chooseValue(v) {
  setVal(v);
  setShowValues(false);
  setTimeout(() => onAdd(), 0);
}
```

### 5. Context Menu Operations

**Supported on multi-selection:**
- **Aktivieren**: Activates selected entries
- **Deaktivieren**: Deactivates selected entries
- **Entfernen**: Removes selected entries

**Implementation:**
```javascript
// DCFilterPanel.jsx, lines 114-124
function activateSelected(active) {
  const cur = DiagnosticContextFilter.getDcEntries();
  const byId = new Map(cur.map((e) => [dcEntryId(e), e]));
  for (const id of sel) {
    const e = byId.get(id);
    if (!e) continue;
    if (active) DiagnosticContextFilter.activateMdcEntry(e.key, e.val);
    else DiagnosticContextFilter.deactivateMdcEntry(e.key, e.val);
  }
  setCtx({ open: false, x: 0, y: 0 });
}
```

### 6. Reset/Clear

**Reset (DiagnosticContextFilter.reset()):**
- Clears all filter entries
- Table updates to show empty state
- **Does not** clear suggestions (MDC data persists)

**Clear Logs (App.jsx clearLogs()):**
- Calls LoggingStore.reset()
- Clears suggestions (MDCListener clears keys Map)
- Clears filter entries
- Clears table and log list

## Table Display

The table shows filter entries with three columns:
- **Key**: MDC key
- **Value**: MDC value (or "(alle)" for wildcard)
- **Active**: Checkbox and badge showing active state

**Key characteristics:**
- Read-only (no inline editing)
- Updates only on filter state changes
- Supports multi-selection (Shift/Ctrl+Click)
- Row click toggles selection
- Right-click opens context menu

## Filter Matching Logic

The filter uses AND logic across keys and OR logic within a key:

```javascript
// Example: userId=user1|user2 AND sessionId=session1
// Matches logs where:
//   (userId="user1" OR userId="user2") AND (sessionId="session1")
```

**Wildcard entries (empty value):**
- Match any value for the key
- Key must be present in the log's MDC

## Testing

A comprehensive test suite is provided in `scripts/verify-mdc-flow.mjs`:

```bash
node scripts/verify-mdc-flow.mjs
```

**Test coverage:**
- MDC extraction from log events
- Incremental suggestion updates
- Change event optimization
- Filter state management
- Activate/deactivate operations
- Reset functionality
- Integration: suggestions vs. filter independence

All tests pass ✅

## Acceptance Criteria Met

✅ **Suggestion sources updated exclusively by incoming logs**
- MDCListener only updates on loggingEventsAdded
- Keys/values accumulated from all log events

✅ **Table refreshes exclusively on filter state changes**
- Table state bound to DiagnosticContextFilter.onChange
- Log events do not trigger table updates

✅ **F2 dialog shows known values per key**
- Dialog populated from MDCListener.getSortedValues(key)
- Auto-triggers Add on value selection

✅ **Context menu operations work on multi-selection**
- Activate/Deactivate/Remove iterate over selected entries
- Operations respect multi-selection via Shift/Ctrl+Click

✅ **Reset clears suggestions, filter, and table**
- LoggingStore.reset() → MDCListener clears keys
- DiagnosticContextFilter.reset() → table clears
- App.jsx clearLogs() ties both together

## Future Enhancements

Potential improvements (not required):
- Bulk import/export of filter configurations
- Filter templates/presets
- Regex support for value matching
- Filter composition (save/load filter sets)
- Performance optimization for very large MDC datasets

## Conclusion

The MDC filter implementation is **complete and functional**. All required behaviors are implemented correctly:
- Log events update suggestions only
- Filter operations update table only
- Clear separation of concerns
- Full UI functionality (ComboBox, F2, context menu, table)
- Robust event handling and state management
