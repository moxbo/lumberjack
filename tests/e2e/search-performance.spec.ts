import { build } from "esbuild";
import { test, expect } from "./electron-fixtures";
import type {
  FilterResponse,
  PagedFilterRequest,
} from "../../src/workers/filterWorker";

test("measures IndexedDB full filtering versus reused navigation search", async ({
  window,
}) => {
  test.skip(!process.env.SEARCH_BENCH_ROWS, "Opt-in real IndexedDB benchmark");
  test.setTimeout(600_000);
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const rows = Number(process.env.SEARCH_BENCH_ROWS);
  expect(Number.isSafeInteger(rows) && rows > 0).toBe(true);
  const bundle = await build({
    entryPoints: ["src/workers/filterWorker.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const metrics = await window.evaluate(
    async ({ rows, source }) => {
      const name = "search-performance";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name, 2);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("payloads", { keyPath: "id" });
          open.result.createObjectStore("projections", { keyPath: "id" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () =>
          reject(open.error ?? new Error("Benchmark database open failed"));
      });
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      try {
        for (let first = 1; first <= rows; first += 2000) {
          const tx = db.transaction("projections", "readwrite");
          const done = new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () =>
              reject(tx.error ?? new Error("Benchmark seed failed"));
          });
          for (let id = first; id <= Math.min(rows, first + 1999); id++) {
            tx.objectStore("projections").put({
              id,
              timestamp: rows - id,
              level: "ERROR",
              logger: "bench.App",
              thread: "",
              source: "bench",
              signature: String(id),
              mdc: null,
              service: null,
              traceId: null,
              _mark: null,
              message: id % 1000 === 0 ? "payment timeout" : "payment accepted",
            });
          }
          await done;
        }
        const options = {
          stdFiltersEnabled: true,
          filter: { level: "ERROR", logger: "bench", thread: "", message: "" },
          onlyMarked: false,
          dcFilterEnabled: false,
          dcFilterEntries: [],
          timeFilterEnabled: false,
          navigationSearch: "",
        };
        const run = (request: PagedFilterRequest) =>
          new Promise<{
            ms: number;
            firstResultMs: number;
            baseIds: number;
            matches: number;
          }>((resolve, reject) => {
            const started = performance.now();
            let firstResultMs = -1;
            let baseIds = 0;
            worker.onerror = (event) => reject(new Error(event.message));
            worker.onmessage = (
              event: MessageEvent<
                FilterResponse | { type: "error"; message: string }
              >,
            ) => {
              if (event.data.type === "error") {
                reject(new Error(event.data.message));
                return;
              }
              const data = event.data;
              if (firstResultMs < 0)
                firstResultMs = performance.now() - started;
              baseIds += data.filteredIndices.length;
              if (!data.partial)
                resolve({
                  ms: performance.now() - started,
                  firstResultMs,
                  baseIds,
                  matches: data.progress?.matches ?? 0,
                });
            };
            worker.postMessage(request);
          });
        const request: PagedFilterRequest = {
          type: "filterPaged",
          requestId: 1,
          generation: "base",
          baseGeneration: "base",
          dataGeneration: 1,
          databaseName: name,
          entryCount: rows,
          markedSignatures: [],
          options,
        };
        const base = await run(request);
        const reused = await run({
          ...request,
          requestId: 2,
          generation: "search",
          knownBaseCount: rows,
          options: { ...options, navigationSearch: "timeout" },
        });
        const forced = await run({
          ...request,
          requestId: 3,
          generation: "force-search",
          baseGeneration: "force",
          options: { ...options, navigationSearch: "timeout" },
        });
        return { rows, base, reused, forced };
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
        db.close();
        await new Promise<void>((resolve, reject) => {
          const deletion = indexedDB.deleteDatabase(name);
          deletion.onsuccess = () => resolve();
          deletion.onerror = () =>
            reject(deletion.error ?? new Error("Benchmark cleanup failed"));
        });
      }
    },
    { rows, source: bundle.outputFiles[0]!.text },
  );
  expect(metrics.reused.baseIds).toBe(0);
  expect(metrics.reused.matches).toBe(Math.floor(rows / 1000));
  expect(metrics.forced.matches).toBe(metrics.reused.matches);
  console.warn("SEARCH_BENCHMARK", JSON.stringify(metrics));
});
