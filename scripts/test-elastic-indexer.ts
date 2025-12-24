import { ElasticIndexer, defaultFingerprint } from "../src/main/ElasticIndexer";

// Simple fake fetch
function makeFetch(
  handler: (url: string, init?: any) => { status: number; body?: any },
) {
  return async (url: string, init?: any) => {
    const r = handler(String(url), init);
    return {
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body ?? {}),
    } as any;
  };
}

function testDeterministicId() {
  const ev = {
    "@timestamp": "2025-03-14T12:34:56.789Z",
    logger: "L",
    thread: "T",
    message: "Hello",
    traceId: "abc",
  };
  const id1 = defaultFingerprint(ev);
  const id2 = defaultFingerprint({ ...ev });
  if (id1 !== id2) throw new Error("Fingerprint not deterministic");
}

async function test409HandlingSingle(): Promise<void> {
  const seen = new Set<string>();
  const fetch = makeFetch((url, _init) => {
    if (url.includes("/_doc/")) {
      const id = decodeURIComponent(url.split("/").pop()!.split("?")[0]!);
      if (seen.has(id)) return { status: 409 };
      seen.add(id);
      return { status: 201 };
    }
    return { status: 500, body: { error: "unexpected" } };
  });
  const idx = new ElasticIndexer({
    baseUrl: "https://es",
    index: "logs",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: fetch as any,
  });
  const ev = { "@timestamp": "2025-01-01T00:00:00.000Z", message: "X" };
  const r1 = await idx.indexOne(ev);
  const r2 = await idx.indexOne(ev);
  if (!r1.ok || r2.error || !r2.ok || !r2.duplicate)
    throw new Error("409 handling failed");
}

async function testBulkPartialConflictsAndRetries(): Promise<void> {
  let tries = 0;
  const seen = new Set<string>();
  const fetch = makeFetch((url, init) => {
    if (url.endsWith("/_bulk")) {
      tries++;
      const lines = String(init.body || "")
        .trim()
        .split("\n");
      const items: any[] = [];
      for (let i = 0; i < lines.length; i += 2) {
        const metaLine = lines[i];
        const docLine = lines[i + 1];
        if (!metaLine || !docLine) continue;
        const meta = JSON.parse(metaLine);

        const _doc = JSON.parse(docLine);
        const id = meta.create?._id || meta.index?._id;
        if (!id) {
          items.push({ create: { status: 500 } });
          continue;
        }
        if (seen.has(id)) items.push({ create: { status: 409 } });
        else if (tries === 1) items.push({ create: { status: 429 } });
        else {
          seen.add(id);
          items.push({ create: { status: 201 } });
        }
      }
      return { status: 200, body: { items } } as any;
    }
    return { status: 500 } as any;
  });
  const idx = new ElasticIndexer({
    baseUrl: "https://es",
    index: "logs",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: fetch as any,
    maxRetries: 2,
    backoffBaseMs: 1,
    bulkSize: 2,
  });
  const docs = [
    { "@timestamp": "2025-01-01T00:00:00.000Z", message: "a" },
    { "@timestamp": "2025-01-01T00:00:00.000Z", message: "b" },
    { "@timestamp": "2025-01-01T00:00:00.000Z", message: "c" },
  ];
  const r = await idx.indexBulk(docs);
  const m = idx.getMetrics();
  if (!r.ok) throw new Error("bulk not ok");
  if (m.created !== 3) throw new Error("unexpected created count");
  if (m.retries < 1) throw new Error("no retries counted");
}

async function run(): Promise<void> {
  console.log("[tests] start ElasticIndexer");
  testDeterministicId();
  console.log("[tests] deterministic id ok");
  await test409HandlingSingle();
  console.log("[tests] 409 single ok");
  await testBulkPartialConflictsAndRetries();
  console.log("[tests] bulk ok");
  console.log("[tests] ElasticIndexer ok");
  process.exit(0);
}

run().catch((e) => {
  console.error("[tests] ElasticIndexer FAILED", e);
  process.exit(1);
});
