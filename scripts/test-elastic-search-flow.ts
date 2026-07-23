/**
 * Smoke test for the Elasticsearch paging engine (src/utils/elasticSearchEngine.ts).
 *
 * The engine drives the real search flow used by the renderer's
 * `useElasticSearch` hook: first page + auto-paging until the `elasticSize`
 * budget is exhausted, replace-mode reset, PIT session handling and
 * error reporting. This standalone script exercises that logic with a fake
 * search backend so regressions in the budgeting math are caught in CI.
 *
 * Run: tsx scripts/test-elastic-search-flow.ts
 */
import {
  executeElasticSearch,
  type ElasticSearchResponse,
  type ExecuteElasticSearchDeps,
} from "../src/utils/elasticSearchEngine";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `${msg}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

interface Harness {
  hasMore: boolean | null;
  nextSearchAfter: unknown;
  pitSessionId: string | null;
  total: number | null;
  loaded: number;
  appended: unknown[];
  replaceResets: number;
  errors: string[];
  searchOpts: any[];
  appendOpts: any[];
}

function newHarness(): Harness {
  return {
    hasMore: null,
    nextSearchAfter: undefined,
    pitSessionId: "__initial__",
    total: null,
    loaded: 0,
    appended: [],
    replaceResets: 0,
    errors: [],
    searchOpts: [],
    appendOpts: [],
  };
}

function makeDeps(
  h: Harness,
  elasticSize: number,
  search: (opts: any) => Promise<ElasticSearchResponse>,
): ExecuteElasticSearchDeps {
  return {
    elasticUrl: "https://es.example",
    elasticSize,
    search: async (opts) => {
      h.searchOpts.push(opts);
      return search(opts);
    },
    // Faithful copy of the hook's appendElasticCapped capping formula.
    appendCapped: (batch, available, options) => {
      h.appendOpts.push(options || {});
      const list = Array.isArray(batch) ? batch : [];
      const take = Math.max(0, Math.min(available, list.length));
      if (take <= 0) return 0;
      const slice = take === list.length ? list : list.slice(0, take);
      h.appended.push(...slice);
      return take;
    },
    onReplaceReset: () => {
      h.replaceResets++;
      // Real reset clears existing entries; mirror that so ordering is testable.
      h.appended.length = 0;
    },
    setHasMore: (v) => (h.hasMore = v),
    setNextSearchAfter: (v) => (h.nextSearchAfter = v),
    setPitSessionId: (v) => (h.pitSessionId = v),
    setTotal: (v) => (h.total = v),
    resetLoaded: () => (h.loaded = 0),
    addLoaded: (n) => (h.loaded += n),
    onError: (m) => h.errors.push(m),
    errorUnknownText: "UNKNOWN",
  };
}

const form = { index: "logs", mode: "relative", duration: "15m", message: "" };

function entries(n: number, tag: string): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}` }));
}

// 1) Single page, no more results: loads everything, clears PIT, sets total.
async function testSinglePage(): Promise<void> {
  const h = newHarness();
  const deps = makeDeps(h, 100, async () => ({
    ok: true,
    entries: entries(30, "a"),
    hasMore: false,
    pitSessionId: "pit-1",
    total: 30,
  }));
  await executeElasticSearch(form, "append", deps);
  eq(h.loaded, 30, "single: loaded");
  eq(h.appended.length, 30, "single: appended");
  eq(h.hasMore, false, "single: hasMore");
  eq(h.pitSessionId, null, "single: PIT cleared when no more results");
  eq(h.total, 30, "single: total");
  eq(h.searchOpts.length, 1, "single: one request");
  eq(
    h.searchOpts[0].trackTotalHits,
    true,
    "single: first request tracks total hits",
  );
}

// 2) Budget cap across multiple pages that always report hasMore=true.
async function testBudgetCap(): Promise<void> {
  const h = newHarness();
  let page = 0;
  const deps = makeDeps(h, 50, async () => {
    page++;
    return {
      ok: true,
      entries: entries(20, `p${page}`),
      hasMore: true,
      nextSearchAfter: [`t${page}`],
      pitSessionId: "pit",
      total: 999,
    };
  });
  await executeElasticSearch(form, "append", deps);
  eq(h.loaded, 50, "budget: loaded capped to elasticSize");
  eq(h.appended.length, 50, "budget: appended capped to elasticSize");
  eq(h.hasMore, true, "budget: hasMore stays true when cap reached");
  eq(h.pitSessionId, "pit", "budget: PIT kept when more results remain");
  eq(h.searchOpts.length, 3, "budget: three pages requested (20+20+10)");
  eq(
    h.searchOpts[0].trackTotalHits,
    true,
    "budget: first page tracks total hits",
  );
  eq(
    h.searchOpts[1].trackTotalHits,
    false,
    "budget: later pages do not track total hits",
  );
  eq(h.searchOpts[1].size, 30, "budget: page 2 size = remaining budget");
  eq(h.searchOpts[2].size, 10, "budget: page 3 size = remaining budget");
  assert(
    Array.isArray(h.searchOpts[1].searchAfter) &&
      h.searchOpts[1].searchAfter[0] === "t1",
    "budget: searchAfter token propagated to next page",
  );
}

// 3) PIT is cleared when a later page reports hasMore=false.
async function testPitClearedMidLoop(): Promise<void> {
  const h = newHarness();
  const pages: ElasticSearchResponse[] = [
    {
      ok: true,
      entries: entries(20, "x"),
      hasMore: true,
      nextSearchAfter: ["t1"],
      pitSessionId: "p1",
    },
    { ok: true, entries: entries(30, "y"), hasMore: false, pitSessionId: "p2" },
  ];
  let i = 0;
  const deps = makeDeps(h, 100, async () => pages[i++]!);
  await executeElasticSearch(form, "append", deps);
  eq(h.loaded, 50, "pit-mid: loaded");
  eq(h.hasMore, false, "pit-mid: hasMore false");
  eq(h.pitSessionId, null, "pit-mid: PIT cleared when results end");
}

// 4) Replace mode resets the entry store exactly once, before the first append.
async function testReplaceReset(): Promise<void> {
  const h = newHarness();
  const deps = makeDeps(h, 100, async () => ({
    ok: true,
    entries: entries(10, "r"),
    hasMore: false,
    pitSessionId: "pit",
  }));
  await executeElasticSearch(form, "replace", deps);
  eq(h.replaceResets, 1, "replace: reset called once");
  // If append had run before reset, the reset would have cleared them -> 0.
  eq(h.appended.length, 10, "replace: entries appended after reset");
  eq(
    h.appendOpts[0].ignoreExistingForElastic,
    true,
    "replace: first append ignores existing",
  );
}

// 5) Error response is reported and nothing is appended.
async function testErrorResponse(): Promise<void> {
  const h = newHarness();
  const deps = makeDeps(h, 100, async () => ({ ok: false, error: "boom" }));
  await executeElasticSearch(form, "append", deps);
  eq(h.errors.length, 1, "error: one error reported");
  eq(h.errors[0], "boom", "error: error message forwarded");
  eq(h.appended.length, 0, "error: nothing appended");
  eq(h.loaded, 0, "error: nothing loaded");
}

// 6) Missing error message falls back to the localised unknown text.
async function testUnknownError(): Promise<void> {
  const h = newHarness();
  const deps = makeDeps(h, 100, async () => ({ ok: false }));
  await executeElasticSearch(form, "append", deps);
  eq(h.errors[0], "UNKNOWN", "unknown-error: fallback text used");
}

// 7) Deduplicated entries still count against the budget (append returns fetched count).
async function testDedupCountsTowardBudget(): Promise<void> {
  const h = newHarness();
  const deps = makeDeps(h, 40, async () => ({
    ok: true,
    entries: entries(40, "d"),
    hasMore: true,
    nextSearchAfter: ["t"],
    pitSessionId: "pit",
  }));
  // Override appendCapped to simulate full deduplication (nothing new stored)
  // while still reporting the fetched count as "used".
  deps.appendCapped = (batch, available) => {
    const take = Math.max(0, Math.min(available, batch.length));
    return take; // pretend all were duplicates: none stored, but counted
  };
  await executeElasticSearch(form, "append", deps);
  eq(h.loaded, 40, "dedup: fetched count consumes the whole budget");
  eq(h.searchOpts.length, 1, "dedup: budget exhausted after one page");
}

async function run(): Promise<void> {
  console.log("[tests] start elasticSearchEngine");
  await testSinglePage();
  console.log("[tests] single page ok");
  await testBudgetCap();
  console.log("[tests] budget cap ok");
  await testPitClearedMidLoop();
  console.log("[tests] PIT clearing ok");
  await testReplaceReset();
  console.log("[tests] replace reset ok");
  await testErrorResponse();
  console.log("[tests] error response ok");
  await testUnknownError();
  console.log("[tests] unknown error ok");
  await testDedupCountsTowardBudget();
  console.log("[tests] dedup budgeting ok");
  console.log("[tests] elasticSearchEngine ok");
  process.exit(0);
}

run().catch((e) => {
  console.error("[tests] elasticSearchEngine FAILED", e);
  process.exit(1);
});
