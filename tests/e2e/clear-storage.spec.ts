import { test, expect } from "./electron-fixtures";
import { build } from "esbuild";

test("measures atomic IndexedDB clearing", async ({ window }) => {
  test.skip(!process.env.CLEAR_BENCH_ROWS, "Opt-in comparison benchmark");
  test.setTimeout(600_000);
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const rows = Number(process.env.CLEAR_BENCH_ROWS ?? 100_000);
  const result = await window.evaluate(async (rows) => {
    const name = "clear-storage-benchmark";
    const open = (version: number, reset = false) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const store of ["payloads", "projections"]) {
            if (reset) db.deleteObjectStore(store);
            const created = db.createObjectStore(store, { keyPath: "id" });
            if (store === "projections") {
              created.createIndex("by-source-signature", [
                "source",
                "signature",
              ]);
            }
          }
        };
        request.onerror = () =>
          reject(request.error ?? new Error("Benchmark database open failed"));
        request.onsuccess = () => resolve(request.result);
      });
    const done = (tx: IDBTransaction) =>
      new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(tx.error ?? new Error("Benchmark transaction aborted"));
        tx.onerror = () =>
          reject(tx.error ?? new Error("Benchmark transaction failed"));
      });
    let db = await open(1);
    const timings: Record<string, number> = {};
    for (const method of ["clear", "recreate", "rotate"]) {
      const started = performance.now();
      for (let first = 1; first <= rows; first += 1000) {
        const tx = db.transaction(["payloads", "projections"], "readwrite");
        const complete = done(tx);
        for (let id = first; id < Math.min(first + 1000, rows + 1); id++) {
          tx.objectStore("payloads").put({
            id,
            entry: { message: `${id}:` + "abcdefghij".repeat(100) },
          });
          tx.objectStore("projections").put({
            id,
            source: "bench.log",
            signature: `v2:${id}`,
            timestamp: id,
          });
        }
        await complete;
      }
      timings[`${method}SeedMs`] = performance.now() - started;
      const clearStarted = performance.now();
      if (method === "clear") {
        const tx = db.transaction(["payloads", "projections"], "readwrite");
        const complete = done(tx);
        tx.objectStore("payloads").clear();
        tx.objectStore("projections").clear();
        await complete;
      } else if (method === "recreate") {
        db.close();
        db = await open(2, true);
      } else {
        const replacement = await new Promise<IDBDatabase>(
          (resolve, reject) => {
            const request = indexedDB.open(`${name}-replacement`, 1);
            request.onupgradeneeded = () => {
              request.result.createObjectStore("payloads", { keyPath: "id" });
              request.result
                .createObjectStore("projections", { keyPath: "id" })
                .createIndex("by-source-signature", ["source", "signature"]);
            };
            request.onerror = () =>
              reject(
                request.error ?? new Error("Replacement database open failed"),
              );
            request.onsuccess = () => resolve(request.result);
          },
        );
        const retired = db;
        db = replacement;
        timings.rotateMs = performance.now() - clearStarted;
        retired.close();
        const deletionStarted = performance.now();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              request.error ?? new Error("Retired database deletion failed"),
            );
        });
        timings.reclaimMs = performance.now() - deletionStarted;
      }
      if (method !== "rotate")
        timings[`${method}Ms`] = performance.now() - clearStarted;
      for (const store of ["payloads", "projections"]) {
        const tx = db.transaction(store);
        const complete = done(tx);
        const count = tx.objectStore(store).count();
        await complete;
        if (count.result !== 0) throw new Error("Clear retained records");
      }
    }
    db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`${name}-replacement`);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(
          request.error ?? new Error("Replacement database deletion failed"),
        );
    });
    return { rows, ...timings };
  }, rows);
  console.warn("CLEAR_BENCHMARK", JSON.stringify(result));
});

test("repository clear preserves failed datasets and promptly rotates large datasets", async ({
  window,
}) => {
  test.setTimeout(600_000);
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const bundle = await build({
    entryPoints: ["src/store/paged/PagedLogRepository.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "ClearStorageTest",
    platform: "browser",
  });
  await window.evaluate(
    `${bundle.outputFiles[0]!.text}\nglobalThis.ClearStorageTest = ClearStorageTest;`,
  );
  const rows = Number(process.env.CLEAR_BENCH_ROWS ?? 10_000);
  const result = await window.evaluate(async (rows) => {
    const { PagedLogRepository } = (
      globalThis as unknown as {
        ClearStorageTest: typeof import("../../src/store/paged/PagedLogRepository");
      }
    ).ClearStorageTest;
    let failOpen: "throw" | "abort" | null = null;
    const factory = {
      open(name: string, version?: number) {
        if (failOpen === "throw" && name.includes("-generation-")) {
          throw new DOMException(
            "Injected replacement failure",
            "UnknownError",
          );
        }
        const request = indexedDB.open(name, version);
        if (failOpen === "abort" && name.includes("-generation-")) {
          request.addEventListener("upgradeneeded", () => {
            queueMicrotask(() => request.transaction?.abort());
          });
        }
        return request;
      },
      deleteDatabase: (name: string) => indexedDB.deleteDatabase(name),
    } as IDBFactory;
    const repository = new PagedLogRepository({
      databaseName: "clear-repository-test",
      indexedDbFactory: factory,
    });
    const seedStarted = performance.now();
    for (let first = 0; first < rows; first += 1000) {
      await repository.putMany(
        Array.from({ length: Math.min(1000, rows - first) }, (_, index) => ({
          timestamp: first + index,
          source: "bench.log",
          signature: `v2:${first + index}`,
          message: `${first + index}:` + "abcdefghij".repeat(100),
        })),
      );
    }
    const seedMs = performance.now() - seedStarted;
    const originalName = repository.databaseName;
    for (const failure of ["throw", "abort"] as const) {
      failOpen = failure;
      let failed = false;
      try {
        await repository.clear();
      } catch {
        failed = true;
      }
      if (
        !failed ||
        repository.databaseName !== originalName ||
        (await repository.count()) !== rows
      ) {
        throw new Error("Failed clear lost the original dataset");
      }
      if (!String((await repository.getPayload(1))?.message).startsWith("0:")) {
        throw new Error("Failed clear lost readable payloads");
      }
    }
    failOpen = null;
    // A retained external reader may delay reclamation, not the dataset switch.
    const reader = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(originalName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Retained reader open failed"));
    });
    const clearStarted = performance.now();
    await repository.clear();
    const clearMs = performance.now() - clearStarted;
    if (
      (await repository.count()) !== 0 ||
      (await repository.getPayload(1)) !== undefined
    ) {
      throw new Error("Successful clear retained records");
    }
    const ids = await repository.putMany([
      {
        timestamp: null,
        message: "new",
        source: "next.log",
        signature: "v2:new",
      },
    ]);
    if (ids[0] !== 1 || (await repository.getPayload(1))?.message !== "new") {
      throw new Error("New generation did not restart with dense IDs");
    }
    if (
      (
        await repository.findExistingSignatures([
          { source: "bench.log", signature: "v2:0" },
        ])
      ).size !== 0
    ) {
      throw new Error("Clear retained stale deduplication signatures");
    }
    const retiredCount = await new Promise<number>((resolve, reject) => {
      const request = reader
        .transaction("payloads")
        .objectStore("payloads")
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Retired row count failed"));
    });
    if (retiredCount !== rows)
      throw new Error("Retired reader changed datasets");
    reader.close();
    await repository.destroy();
    const remaining = (await indexedDB.databases()).filter(({ name }) =>
      name?.startsWith("clear-repository-test"),
    );
    if (remaining.length)
      throw new Error("Destroy leaked generation databases");
    return { rows, seedMs, clearMs };
  }, rows);
  console.warn("REPOSITORY_CLEAR_BENCHMARK", JSON.stringify(result));
});
