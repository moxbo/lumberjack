# Hooks Architecture

The renderer uses Preact hooks to separate application state from the log list
and dialogs in `App.tsx`.

## Data flow

- `useEntryManagement` persists canonical payloads and publishes
  `MetadataSnapshot` views backed by immutable sorted pages. Late TCP/tail entries
  copy only touched row/ID pages and the small page directories, not the entire
  historical dataset. Older views retain their ordering and positions.
- `ReadonlySequence<T>` is the shared interface for snapshots and native arrays.
  Use `.at(index)` for indexed reads and `.slice(start, end)` for bounded pages.
  Do not materialize entire snapshots on each append.
- `entries.ids` shares the metadata snapshot's stable ordering.
  `useIdPositions` uses the snapshot's paged ID lookup and binary rank lookup;
  arbitrary filtered arrays receive a fresh index because their ordering may
  have changed. Never mutate the ID or timestamp of a published entry.
- `useFilterWorker` sends projections to the filter worker.
  `usePagedLogHydration` loads payloads needed by visible rows.
- `main/EntryPayloadStore.ts` retains large originals before delivery.
  Paged entries keep `_payloadRef` and a display preview, not the full strings.
  Use `utils/entryPayload.ts`'s `loadFullEntry` only for explicit full inspection,
  copying or export, never for list hydration. References belong to one window
  and are reclaimed after a committed clear or window destruction; failed
  replacement preparation preserves the originals.
- `useFixedRowVirtualizer` maps fixed-height log rows onto a scroll surface
  capped at 8,000,000 CSS pixels, below browser layout limits. Navigation and
  stable-ID anchoring use logical offsets; DOM row positions and scrollbar
  offsets use the capped coordinate space. Only viewport rows plus overscan
  are materialized, even when removing a filter exposes millions of entries.

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

Completed worker base results are cached independently of navigation text/mode.
Streaming requests opt into `baseDelta` responses with `reset`, `fromLength`
and only newly passing references. The hook validates the expected prefix length
and inserts deltas into sorted snapshots, including out-of-order timestamps.
Progress does not recount historical matches on each append. Non-opt-in worker
clients retain the cumulative-array protocol.
Streaming scans flush reference batches at a bounded page/8,000-reference
threshold as well as the progress cadence. The hook coalesces intermediate
visible publications at 100 ms; first and final results remain immediate.
Navigation-only requests send sorted match deltas instead of retransmitting the
base ID sequence; the hook merges them into its cumulative result snapshots.
`cancelFiltering(true)` cancels obsolete matches while retaining the base view.
The workerless fallback remains a cooperative scan, not a cached search index.

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

App keeps the base-view identity separate from the navigation query identity.
A new navigation term or case/regex mode must not blank a completed filtered
list or replace its ID sequence on every match update. Genuine filter, relevant
mark, database or data-generation changes still invalidate the base view.
Match counters and previous/next navigation use binary lookup in sorted visual
match positions. Sorted match snapshots project positions lazily instead of
materializing potentially millions of positions on each append.

Message-only filters use persisted compact search pages: individually lowercased
messages, row offsets, IDs and original timestamps, optionally gzip-compressed.
`PagedLogRepository` writes them atomically with payloads and projections.
Preparing this extra column adds import work in exchange for faster repeated
filtering; it does not duplicate full payloads.
Each page covers 2,000 IDs; only the last committed page stays decoded during
appends, bounded to 2 Mi characters. Missing pages (including upgraded older
databases) and oversized pages fall back to authoritative projections. Storage
and decoding failures remain errors, not empty results.

The worker reads at most four search pages per request and caches exact literal
match flags in a 16 MiB estimated LRU budget. AND/OR/NOT combinations reuse these
flags, keyed by page revision and invalidated on dataset changes. Substring
semantics, per-message Unicode casing and row boundaries are preserved. Only
stored previews are searched; filtering never hydrates original payload files.
Active level/logger/thread, mark, time/DC constraints or navigation search retain
the projection path and its rejection-statistics order. Enabled but empty time/DC
filters do not disable the compact path.

New uncached literals still scan compact message text: this is not an inverted
full-text index. Navigation search still reads relevant projection pages using
bounded `getAll()` ranges and skips pages without base-filter candidates. Boolean
and regex matchers are compiled once per request.
For an opt-in Electron/IndexedDB measurement with short synthetic messages, run
`SEARCH_BENCH_ROWS=1000000 npx playwright test tests/e2e/search-performance.spec.ts`
after building the application. It compares base reuse with forced refiltering
and reports timing and transferred base IDs, not a real 1–5 GB workload guarantee.

For an actual NDJSON import and UI message-filter benchmark, build with
`npm run prebuild && npm run build:renderer`, then run
`FILTER_BENCH_FILE=/absolute/path/to/logs.ndjson npx playwright test tests/e2e/message-filter-performance.spec.ts --trace=off`.
It reports import, worker and UI timings and verifies zero/all-match, negation,
boolean and repeated-literal counts. `FILTER_BENCH_MAX_MS` optionally enforces
a per-query worker-time ceiling. It uses an isolated temporary Electron profile
and does not modify the input file.
Keep the host awake throughout the run: system sleep invalidates latency
measurements and can exceed the import acknowledgement deadline.

## Background windows and live sources

`VisibilityScheduler` coalesces metadata and worker-result UI publication to
once per second while the document is hidden/minimized, and flushes the latest
view when it becomes visible. Cancellation and clearing discard pending views.
The native `window:visibility` bridge handles hide/show and minimize/restore:
Electron otherwise reports a visible document when background throttling is off.
Ingestion, IndexedDB persistence, producer acknowledgements and backpressure
never wait for this scheduler. Reaching the live-entry limit publishes control
state immediately, including while hidden. Electron background throttling stays
disabled to preserve ingestion and acknowledgement timers.

TCP and HTTP-tail continue to share the window's live-entry allowance; the cap
stops owned live sources rather than evicting older entries. Other instances have
their own allowances and resource usage.

HTTP-tail reports the observed transfer mode through its list/status API.
A `200` response to an actual Range request indicates full-download fallback;
the initial offset-zero download alone does not. The status area retains a
warning while any active tail uses full downloads, with a notification on entry
into that mode. A later partial response clears it. Prefix skipping still avoids
re-parsing old bytes, but cannot avoid the repeated network transfer.

## Storage failures

IndexedDB failures must not migrate the existing dataset into renderer memory.
Failed persistence pauses ingestion and reports an error to the user and the
awaiting producer. Already persisted entries remain available for browsing and
export as long as IndexedDB reads still work. A read failure is reported rather
than represented as an empty or successfully recovered dataset.
Only a `QuotaExceededError` in the cause chain is classified as a quota failure.
An ordinary transaction abort retains its original error instead of claiming
that storage is full.

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

## Live intake limit

The persisted `liveEntryLimit` setting defaults to 500,000 unique live entries
per window's current dataset. `useEntryManagement` enforces it inside the
serialized persistence queue, after deduplication, for `appendEntriesAsync`
calls with `{ live: true }`. Imported files, manual HTTP loads and Elasticsearch
searches do not consume this allowance and remain usable when live intake pauses.
An entry-count limit is not a process-wide memory limit.

At the limit, existing entries remain intact and available for search/export.
An overflowing batch persists only the available prefix and rejects with
`LiveIngestionLimitError`; this must not trigger storage-failure recovery or
automatic replay. In-flight live batches cannot exceed the remaining allowance.
The workspace status row shows live utilization as a circular indicator. Hover
or focus reveals the current count, maximum, and a link to the limit setting;
clicking the indicator opens that setting directly. A paused intake is also
marked inline, with the warning about potentially lost messages in the tooltip.
Raising the limit or successfully clearing the dataset releases the intake
gate; sources must then be restarted manually. Lowering a limit below the current
live count pauses intake without deleting existing data.

Main-process delivery stamps `_ingestionKind` on append batches, preserving
import/live boundaries when batching. The renderer removes this transport field
before persistence. Never infer live provenance from an entry's source string:
an imported export can contain TCP or HTTP source names.

Cap failures remain negative ACKs, not success acknowledgements of partially
persisted batches. A structured `live-entry-limit` rejection lets the shared,
bounded window queue reject pending live receipts while continuing untouched
imports. Never replay acknowledged prefixes or rejected live batches. Ordinary
persistence failures still terminate delivery across both origins.

## Source backpressure

TCP delivery awaits file logging and the existing renderer `logs:appendAck`
before resuming socket reads. Window queues retain at most 8,192 entries and
32 MiB, including unready/in-flight delivery, with a 30-second timeout. The
timeout is progress-based: while a batch is still being persisted, the preload
sends `logs:appendProgress` heartbeats every 10 seconds, which re-arm both the
renderer ack deadline and the window queue receipts. A slow-but-alive renderer
therefore applies backpressure to the source instead of resetting it; only a
dead renderer or a persistence error terminates the connection. TCP sockets
have no inactivity timeout (log sources are legitimately idle); dead peers are
detected via TCP keepalive (60 s). File
writers also have finite defaults: 1,024 operations and 16 MiB. These are
independent budgets, not a shared process-wide cap. Automatic file logging
serializes records only after writer admission, uses bounded write buffers and
rotates only between complete records. An individual record may exceed the
rotation target; it must not be split across backups or interleaved with another
source. Parsing and serializing an original still needs per-record memory.

HTTP polling and file/HTTP tailing await downstream consumption before reading
the next chunk. HTTP-tail reads are 64 KiB. TCP and streamed file imports split
lines with `LogLineSplitter` (`src/utils/entryLimits.ts`), preserving complete
JSON envelopes and UTF-8 content regardless of the display-preview length.
File/HTTP tails also wait for complete lines instead of enforcing a display-size
limit on input. The main process retains large originals as compressed,
window-owned disk payloads before admitting their previews to the append queue.
`_truncated` describes only the view; `_messageSize` is the complete message's
UTF-8 byte count. Full inspection, copying and export resolve `_payloadRef` on
demand, while ordinary row hydration never loads the original. Highlighting
caches do not retain these large originals after inspection.
`measureEntryPayload` validates the 32 MiB transport budget without modifying
content; it must only receive already-prepared previews. Window-queue capacity
refusals make TCP delivery wait for in-flight progress rather than terminate
the connection. Streaming imports allow one active
session per renderer and 16 globally, and require readiness/persistence
acknowledgements within 30 seconds.

Capacity, timeout and storage errors propagate to the source instead of silently
dropping queued entries or replaying ambiguously committed batches. Restart a
stopped source explicitly after resolving the error. There is no HTTP ingestion
server here: HTTP operations report failures through IPC, not HTTP 503.
Raw TCP has no durable application-level acknowledgement to its sender, so this
flow control does not provide exactly-once delivery. Legacy whole-document JSON
and ZIP parsing are not converted to streaming by these changes.
