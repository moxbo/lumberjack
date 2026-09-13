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
