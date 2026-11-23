import { test, expect, openLogFiles } from "./electron-fixtures";

interface BenchmarkRun {
  requestId: number;
  started: number;
  firstResultMs?: number;
  elapsedMs?: number;
  passed?: number;
  total?: number;
  error?: string;
}

declare global {
  interface Window {
    messageFilterBenchmark: {
      imported: boolean;
      importError?: string;
      indexWrites: { gzip: number; plain: number; omitted: number };
      current: BenchmarkRun | null;
    };
  }
}

test("measures message filters on an imported NDJSON dataset", async ({
  electronApp,
  window: page,
}) => {
  const input = process.env.FILTER_BENCH_FILE;
  test.skip(!input, "Opt-in benchmark using a local log file");
  test.setTimeout(900_000);
  page.on("crash", () =>
    console.error("MESSAGE_FILTER_BENCHMARK renderer crashed"),
  );
  page.on("pageerror", (error) =>
    console.error("MESSAGE_FILTER_BENCHMARK", error),
  );
  await page.addInitScript(() => {
    const state: Window["messageFilterBenchmark"] = {
      imported: false,
      indexWrites: { gzip: 0, plain: 0, omitted: 0 },
      current: null,
    };
    window.messageFilterBenchmark = state;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Forward with the original receiver below.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...key) {
      if (this.name === "message-search") {
        const encoding = value.omitted
          ? "omitted"
          : typeof value.text === "string"
            ? "plain"
            : "gzip";
        state.indexWrites[encoding]++;
      }
      return put.call(this, value, ...key);
    };
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          const run = state.current;
          const data = event.data;
          if (!run || data.requestId !== run.requestId) return;
          if (data.type === "error") run.error = data.message;
          if (data.type !== "result") return;
          run.firstResultMs ??= performance.now() - run.started;
          if (!data.partial) {
            run.elapsedMs = performance.now() - run.started;
            run.passed = data.stats.passed;
            run.total = data.stats.total;
          }
        });
      }

      override postMessage(
        message: unknown,
        transfer: Transferable[] | StructuredSerializeOptions = [],
      ) {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "filterPaged" &&
          "requestId" in message &&
          typeof message.requestId === "number"
        ) {
          state.current = {
            requestId: message.requestId,
            started: performance.now(),
          };
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  await page.reload();
  await expect(page.locator("#splash-screen")).toHaveCount(0);
  await page.evaluate(() => {
    window.api.onStreamComplete((result) => {
      if (result.errors.length) {
        window.messageFilterBenchmark.importError = result.errors.join("\n");
      }
      window.messageFilterBenchmark.imported = true;
    });
    window.api.onStreamError((error) => {
      window.messageFilterBenchmark.importError = JSON.stringify(error);
    });
  });
  const importStart = performance.now();
  await openLogFiles(electronApp, [input!]);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            window.messageFilterBenchmark.imported ||
            window.messageFilterBenchmark.importError ||
            document.querySelector(".workspace-storage-error"),
          ),
        ),
      { timeout: 600_000, intervals: [500] },
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.messageFilterBenchmark.importError),
  ).toBeUndefined();
  await expect(page.locator(".workspace-storage-error")).toHaveCount(0);
  const importMs = performance.now() - importStart;
  const { indexWrites, storageBytes } = await page.evaluate(async () => ({
    indexWrites: window.messageFilterBenchmark.indexWrites,
    storageBytes: (await navigator.storage.estimate()).usage,
  }));
  if (process.env.FILTER_BENCH_INDEX === "plain") {
    expect(
      indexWrites.gzip,
      "Rebuild the renderer with FILTER_BENCH_INDEX=plain",
    ).toBe(0);
  }
  if (!(await page.locator("#filterMessage").isVisible())) {
    await page.locator(".filter-toggle-btn").click();
  }
  const runs: Array<BenchmarkRun & { query: string; uiMs: number }> = [];
  const absent = "__lumberjack_benchmark_absent_4f729d__";
  for (const query of [
    "error",
    absent,
    `!${absent}`,
    `error AND NOT ${absent}`,
    "NOT error",
    "error",
  ]) {
    await page.locator("#filterMessage").fill(query);
    await page.evaluate(() => {
      window.messageFilterBenchmark.current = null;
    });
    const started = performance.now();
    await page.locator("#filterMessage").press("Enter");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const run = window.messageFilterBenchmark.current;
            return Boolean(run?.error || run?.elapsedMs !== undefined);
          }),
        { timeout: 120_000, intervals: [50] },
      )
      .toBe(true);
    const run = await page.evaluate(
      () => window.messageFilterBenchmark.current!,
    );
    expect(run.error).toBeUndefined();
    await expect(page.locator(".filter-progress")).toHaveCount(0);
    await expect(page.locator("#countFiltered")).toHaveText(String(run.passed));
    runs.push({ ...run, query, uiMs: performance.now() - started });
  }
  expect(runs[1]!.passed).toBe(0);
  expect(runs[2]!.passed).toBe(runs[0]!.total);
  expect(runs[3]!.passed).toBe(runs[0]!.passed);
  expect(runs[4]!.passed! + runs[0]!.passed!).toBe(runs[0]!.total);
  expect(runs[5]!.passed).toBe(runs[0]!.passed);
  const pageWrites = indexWrites.gzip + indexWrites.plain + indexWrites.omitted;
  expect(pageWrites).toBe(Math.ceil(runs[0]!.total! / 2_000));
  console.warn(
    "MESSAGE_FILTER_BENCHMARK",
    JSON.stringify({ importMs, indexWrites, storageBytes, runs }),
  );
  if (process.env.FILTER_BENCH_MAX_MS) {
    const limit = Number(process.env.FILTER_BENCH_MAX_MS);
    expect(Number.isFinite(limit) && limit > 0).toBe(true);
    for (const run of runs) expect(run.elapsedMs).toBeLessThan(limit);
  }
});
