# Hooks Architecture

The renderer uses Preact hooks to separate application state from the log list
and dialogs in `App.tsx`.

## Data flow

- `useEntryManagement` persists canonical payloads and publishes
  `MetadataSnapshot` views. Monotonic appends extend write-once segments;
  publication does not copy previously loaded metadata. Reordering and clearing
  replace the backing store so older views remain stable.
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
The progress indicator shows processed/total counts only while a scan is running.
Match counts remain in the existing navigation counter; filtered row counts
remain in the toolbar rather than being repeated in the progress indicator.

## Storage failures

IndexedDB failures must not migrate the existing dataset into renderer memory.
Failed persistence pauses ingestion and reports an error to the user and the
awaiting producer. Already persisted entries remain available for browsing and
export as long as IndexedDB reads still work. A read failure is reported rather
than represented as an empty or successfully recovered dataset.

After resolving the storage problem, explicitly clear the logs to begin a new
storage generation before importing again. Export required data first: clearing
is destructive. Do not resume appends automatically after a failed write because
IDs may have been reserved without a committed record; paged filtering requires
dense IDs within each generation. A failed clear must leave ingestion paused.

## Payload-cache budget

`PagedLogRepository({ maxCachedBytes })` forwards its budget to
`PageLruCache({ maxBytes })`; the default is 64 MiB in addition to the page-count
limit. `estimatePayloadBytes` estimates decoded heap usage without serializing a
second JSON copy. Strings count as UTF-16, not their compressed or UTF-8 size.

Cache statistics expose `residentBytes`, `maxBytes`, `bytesEstimated`,
`evictedBytes` and `oversizedPages`. Oversized pages are returned to the caller
but not retained in the cache. Page reads/decompression are serialized and
coalesced, including across invalidation, to avoid concurrent decoded pages
multiplying transient memory. The limit is not a process-wide heap cap: active
page loads and references held by hydration/export consumers remain outside it.

## Renderer admission

`useEntryManagement({ ingestionLimits })` defaults to 100,000 entries and 64 MiB
of estimated retained producer inputs. This budget is separate from the payload
cache. The entire input array is reserved, not just its first queued slice;
otherwise a small queue could still retain a multi-gigabyte parent array.
Inputs exceeding available capacity reject with `IngestionBusyError`.

Producers must await `appendEntriesAsync` and send bounded chunks. Each admitted
input is persisted in sequential 2,000-entry transactions; acknowledgements and
progress follow persistence. Do not acknowledge an errored batch or automatically
replay it: an earlier transaction may already have committed. `clearEntries`
returns a promise; replacement imports must await its successful completion.

## Source backpressure

TCP delivery awaits file logging and the existing renderer `logs:appendAck`
before resuming socket reads. Window queues retain at most 8,192 entries and
32 MiB, including unready/in-flight delivery, with a 30-second timeout. File
writers also have finite defaults: 1,024 operations and 16 MiB. These are
independent budgets, not a shared process-wide cap.

HTTP polling and file/HTTP tailing await downstream consumption before reading
the next chunk. HTTP-tail reads are 64 KiB; network/streaming line handling has
a 1 MiB limit. Streaming imports allow one active session per renderer and
16 globally, and require readiness/persistence acknowledgements within 30 seconds.

Capacity, timeout and storage errors propagate to the source instead of silently
dropping queued entries or replaying ambiguously committed batches. Restart a
stopped source explicitly after resolving the error. There is no HTTP ingestion
server here: HTTP operations report failures through IPC, not HTTP 503.
Raw TCP has no durable application-level acknowledgement to its sender, so this
flow control does not provide exactly-once delivery. Legacy whole-document JSON
and ZIP parsing are not converted to streaming by these changes.
