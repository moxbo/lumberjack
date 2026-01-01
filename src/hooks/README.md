# Hooks Architecture

This directory contains React/Preact hooks for the Lumberjack log viewer application.

## Hooks Used in App.tsx

| Hook                 | Description                                                    | Status |
|----------------------|----------------------------------------------------------------|--------|
| `useFilterState`     | Manages filter state (search, logger, thread, message filters) | ✅ Used |
| `useDebounce`        | Debounces values for better typing performance                 | ✅ Used |
| `useAlerts`          | Alert dialog and feature error handling                        | ✅ Used |
| `useHistoryPopovers` | History dropdown popovers state                                | ✅ Used |

## Available Hooks (Not Yet Integrated)

| Hook                    | Description                                                   |
|-------------------------|---------------------------------------------------------------|
| `useSettings`           | Manages application settings (TCP, HTTP, Elastic, appearance) |
| `useSelection`          | Manages row selection state                                   |
| `useEntryManagement`    | Manages log entries (state, IPC queue, deduplication)         |
| `useElasticSearch`      | Elasticsearch search functionality                            |
| `useKeyboardNavigation` | Keyboard shortcuts and navigation                             |
| `useResizable`          | Panel resize functionality                                    |
| `usePopover`            | Popover state management                                      |
| `useContextMenu`        | Context menu state                                            |
| `useHttpPolling`        | HTTP polling functionality                                    |
| `useFeatureFlags`       | Feature flag management                                       |

## Usage Example

```tsx
import { useFilterState, useDebounce, useAlerts, useHistoryPopovers } from "../hooks";

function MyComponent() {
  const filterState = useFilterState();
  const debouncedSearch = useDebounce(filterState.search, 200);
  const { alertState, showAlert, closeAlert, handleFeatureError } = useAlerts();
  const historyPopovers = useHistoryPopovers();
  
  // Use the hooks...
}
```

## Refactoring Progress

The `App.tsx` file was originally ~4600 lines. Current size: ~4340 lines.

### Extracted and Used:
1. **Debug utilities** → `src/utils/debugFunctions.ts` (~140 lines)
2. **History popovers** → `src/hooks/useHistoryPopovers.ts` ✅ Used
3. **Alerts** → `src/hooks/useAlerts.ts` ✅ Used
4. **Filter state** → `src/hooks/useFilterState.ts` ✅ Used (was pre-existing)

### Future Refactoring Opportunities

To further reduce `App.tsx`, the following large code blocks could be extracted:

1. **IPC listeners setup** (~150 lines) - Complex due to many dependencies
2. **Entry management** (~300 lines) - Requires careful state management
3. **Elasticsearch logic** (~200 lines) - Complex async operations
4. **Virtualizer setup** (~100 lines) - Tightly coupled with selection

Each extraction requires careful consideration of dependencies and state management.
