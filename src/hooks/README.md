# Hooks Architecture

The renderer uses Preact hooks to separate application state from the log list
and dialogs in `App.tsx`.

## Data flow

- `useEntryManagement` persists canonical payloads and publishes
  `MetadataSnapshot` views. Monotonic appends extend write-once segments;
  publication does not copy previously loaded metadata. Reordering, clearing
  and in-memory recovery replace the backing store so older views remain stable.
- `ReadonlySequence<T>` is the shared interface for snapshots and native arrays.
  Use `.at(index)` for indexed reads and `.slice(start, end)` for bounded pages.
  Do not materialize entire snapshots on each append.
- `entries.ids` shares the metadata snapshot's stable ordering.
  `useIdPositions` reuses its incremental reverse index; arbitrary filtered
  arrays receive a fresh index because their ordering may have changed.
- `useFilterWorker` sends projections to the filter worker.
  `usePagedLogHydration` loads payloads needed by visible rows.

## Application state

- `useSettings` owns loading, editing and saving application settings.
  App-specific state such as filter histories and marks is restored through
  its integration callbacks rather than a second settings loader.
- `useFilterState`, `useTimeFilterDialog` and `useElasticSearch` own filter,
  history and Elasticsearch interactions.
- `useAlerts`, `useToasts`, `useContextMenuActions` and `useResizeHandlers`
  isolate dialog, notification and interaction state.

## Export

`utils/exportCurrentView.ts` snapshots the selected IDs and marks, retrieves
payloads in bounded pages, and streams all supported formats through the typed
preload API. Each byte chunk is acknowledged before the next is submitted.
The main process publishes the temporary file only after a successful finish;
errors and window destruction cancel the export and clean up the partial file.

## Progressive search

`useFilterWorker` publishes cumulative result snapshots, stable `searchMatchIds`,
and `progress` (`processed`, `total`, `matches`). Query identity includes navigation
text/mode, filters, relevant marks, database and data generation. New queries and
`cancelFiltering()` invalidate obsolete results; same-query appends queue behind
the current scan so continuous input cannot starve results.

The worker scans projection pages rather than loading all messages before
filtering. It publishes the first page immediately and throttles subsequent
updates. Passing references retain IDs, timestamps and match flags, not message
text; the optional transferred projection cache is bounded and missing pages are
read from IndexedDB. Navigation search has no 50,000-row cutoff.

The search field still commits on Enter and navigates within the current log
view; it does not turn navigation search into a message filter. App maps match
IDs to current visual positions because partial worker positions can differ
from the full list. New matches preserve stable-ID selection and the viewport
anchor, and manual interaction cancels any pending automatic navigation.
