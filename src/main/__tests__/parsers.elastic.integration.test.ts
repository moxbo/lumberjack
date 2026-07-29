/**
 * Testcontainers integration tests for the Elasticsearch/OpenSearch query
 * implementation in parsers.ts + esMessageQuery.ts.
 *
 * These tests spin up real containers and exercise the full stack:
 *   buildElasticMessageQuery → fetchElasticPitPage → ES/OS HTTP API
 *
 * Run:  npm run test:integration
 *
 * Matrix:
 * - Elasticsearch 8.13.4 (PIT)
 * - OpenSearch 2.13.0 (PIT)
 * - Elasticsearch 6.8.23 (scroll, skipped on arm64 because no image exists)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import * as nodeHttp from "http";
import { fetchElasticPitPage } from "../parsers";
import type { ElasticsearchPitOptions } from "../parsers";

const IS_ARM64 = process.arch === "arm64";

const INDEX = "lumberjack-it";

/** Five documents with distinct tokens per field for deterministic assertions. */
const DOCS = [
  {
    id: "1",
    "@timestamp": "2026-01-01T10:00:00.000Z",
    message: "alpha bravo connected",
    logger_name: "com.example.Network",
    logger: "com.example.Network",
  },
  {
    id: "2",
    "@timestamp": "2026-01-01T10:00:01.000Z",
    message: "charlie delta error timeout",
    logger_name: "com.example.Service",
    logger: "com.example.Service",
  },
  {
    id: "3",
    "@timestamp": "2026-01-01T10:00:02.000Z",
    message: "echo foxtrot warning memory",
    logger_name: "com.example.Monitor",
    logger: "com.example.Monitor",
  },
  {
    id: "4",
    "@timestamp": "2026-01-01T10:00:03.000Z",
    message: "golf hotel cache hit",
    logger: "com.example.Cache",
  },
  {
    id: "5",
    "@timestamp": "2026-01-01T10:00:04.000Z",
    message: "india juliet fatal lost",
    logger_name: "com.example.Database",
    logger: "com.example.Database",
  },
  {
    id: "6",
    // Same timestamp as document 4 so pagination depends on the tie-breaker.
    "@timestamp": "2026-01-01T10:00:03.000Z",
    message: "kilo lima worker ready",
    logger_name: "com.example.Worker",
  },
] as const;

type EsResponse = { status: number; json: unknown; text: string };

/** Minimal Node.js http.request wrapper used only for index/bulk setup. */
function esHttp(
  baseUrl: string,
  method: string,
  path: string,
  rawBody: string,
  contentType = "application/json",
): Promise<EsResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, baseUrl);
    const bodyBuf = rawBody ? Buffer.from(rawBody, "utf8") : null;
    const req = nodeHttp.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": contentType,
          Accept: "application/json",
          ...(bodyBuf ? { "Content-Length": String(bodyBuf.byteLength) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* empty – non-JSON body */
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function esJson(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<EsResponse> {
  return esHttp(
    baseUrl,
    method,
    path,
    body != null ? JSON.stringify(body) : "",
  );
}

/**
 * Creates the test index with an appropriate mapping and bulk-indexes all
 * DOCS, then forces a refresh so documents are immediately searchable.
 *
 * @param esVersion Major version number (6 for 6.x, 7/8 for modern ES/OS).
 */
async function setupIndex(baseUrl: string, esVersion: number): Promise<void> {
  const properties = {
    "@timestamp": { type: "date" },
    // text so wildcard query_string substring search works per-token
    message: { type: "text" },
    // keyword so wildcard query_string works on the full dotted class name
    logger_name: { type: "keyword" },
    logger: { type: "keyword" },
  };

  const mappingBody =
    esVersion < 7
      ? {
          settings: { number_of_shards: 1, number_of_replicas: 0 },
          mappings: { _doc: { properties } },
        }
      : {
          settings: { number_of_shards: 1, number_of_replicas: 0 },
          mappings: { properties },
        };

  const deleted = await esJson(baseUrl, "DELETE", `/${INDEX}`);
  if (deleted.status !== 200 && deleted.status !== 404) {
    throw new Error(
      `Index deletion failed (${deleted.status}): ${deleted.text.slice(0, 400)}`,
    );
  }

  const created = await esJson(baseUrl, "PUT", `/${INDEX}`, mappingBody);
  if (created.status >= 400) {
    throw new Error(
      `Index creation failed (${created.status}): ${created.text.slice(0, 400)}`,
    );
  }

  // Build NDJSON bulk body
  const lines: string[] = [];
  for (const doc of DOCS) {
    const { id, ...source } = doc;
    const meta =
      esVersion < 7
        ? { index: { _index: INDEX, _type: "_doc", _id: id } }
        : { index: { _index: INDEX, _id: id } };
    lines.push(JSON.stringify(meta), JSON.stringify(source));
  }
  const ndjson = lines.join("\n") + "\n";

  const bulk = await esHttp(
    baseUrl,
    "POST",
    "/_bulk",
    ndjson,
    "application/x-ndjson",
  );
  if (bulk.status >= 400) {
    throw new Error(
      `Bulk index failed (${bulk.status}): ${bulk.text.slice(0, 400)}`,
    );
  }
  const bulkJson = bulk.json as Record<string, unknown> | null;
  if (bulkJson?.errors === true) {
    throw new Error(`Bulk index reported errors: ${bulk.text.slice(0, 800)}`);
  }

  // Force refresh so docs are immediately queryable
  const refresh = await esJson(baseUrl, "POST", `/${INDEX}/_refresh`);
  if (refresh.status >= 400) {
    throw new Error(
      `Index refresh failed (${refresh.status}): ${refresh.text.slice(0, 200)}`,
    );
  }
}

async function expectNoOpenSearchContexts(baseUrl: string): Promise<void> {
  const response = await esJson(
    baseUrl,
    "GET",
    "/_nodes/stats/indices/search?filter_path=nodes.*.indices.search.open_contexts",
  );
  if (response.status >= 400) {
    throw new Error(
      `Search context stats failed (${response.status}): ${response.text.slice(0, 400)}`,
    );
  }

  type SearchStats = {
    nodes?: Record<
      string,
      { indices?: { search?: { open_contexts?: number } } }
    >;
  };
  const nodes = (response.json as SearchStats | null)?.nodes ?? {};
  const openContexts = Object.values(nodes).reduce(
    (sum, node) => sum + (node.indices?.search?.open_contexts ?? 0),
    0,
  );
  expect(openContexts).toBe(0);
}

/**
 * Pages through all results with the given query opts (size=2) and returns
 * the messages of every returned entry.  Works for both PIT and scroll modes.
 */
async function collectAllMessages(
  baseOpts: Omit<ElasticsearchPitOptions, "pitSessionId" | "searchAfter">,
): Promise<string[]> {
  const messages: string[] = [];
  let sessionId: string | undefined;
  let searchAfter: Array<string | number> | null = null;
  let hasMore = true;

  while (hasMore) {
    const opts: ElasticsearchPitOptions = {
      ...baseOpts,
      size: 2,
      pitSessionId: sessionId,
      ...(searchAfter != null ? { searchAfter } : {}),
    };
    const page = await fetchElasticPitPage(opts);
    for (const entry of page.entries) {
      if (entry.message) messages.push(entry.message);
    }
    sessionId = page.pitSessionId;
    searchAfter = page.nextSearchAfter;
    hasMore = page.hasMore;
  }

  return messages;
}

/**
 * Shared tests run against every container flavour.  Accepting `getBaseUrl`
 * as a thunk avoids capturing a variable before it is assigned in beforeAll.
 */
function runSharedTests(getBaseUrl: () => string): void {
  it("simple message query - single token substring match", async () => {
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      message: "bravo",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.message).toContain("bravo");
    expect(result.hasMore).toBe(false);
    await expectNoOpenSearchContexts(getBaseUrl());
  });

  it("message AND (&) - both tokens must be present", async () => {
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      message: "delta & timeout",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.message).toContain("timeout");
    expect(result.hasMore).toBe(false);
  });

  it("message OR (|) - either token matches", async () => {
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      message: "connected | warning",
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.some((e) => e.message?.includes("connected"))).toBe(
      true,
    );
    expect(result.entries.some((e) => e.message?.includes("warning"))).toBe(
      true,
    );
    expect(result.hasMore).toBe(false);
  });

  it("message NOT (!) - excludes matched docs", async () => {
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      message: "!timeout",
    });

    // All docs except doc2 (only one with "timeout")
    expect(result.entries).toHaveLength(DOCS.length - 1);
    expect(result.entries.every((e) => !e.message?.includes("timeout"))).toBe(
      true,
    );
    expect(result.hasMore).toBe(false);
  });

  it("parentheses / precedence - (A | B) & (C | D)", async () => {
    // (charlie | echo) & (error | warning)
    // doc2: charlie + error
    // doc3: echo + warning
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      message: "(charlie | echo) & (error | warning)",
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.some((e) => e.message?.includes("error"))).toBe(true);
    expect(result.entries.some((e) => e.message?.includes("warning"))).toBe(
      true,
    );
    expect(result.hasMore).toBe(false);
  });

  it("logger_name boolean OR search", async () => {
    // logger filter targets ["logger_name", "logger"] fields (keyword type)
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      logger: "com.example.Worker | com.example.Monitor",
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.some((e) => e.logger === "com.example.Worker")).toBe(
      true,
    );
    expect(result.entries.some((e) => e.logger === "com.example.Monitor")).toBe(
      true,
    );
    expect(result.hasMore).toBe(false);
  });

  it("fallback logger field boolean AND search", async () => {
    // Document 4 has no logger_name, so both terms must match via logger.
    const result = await fetchElasticPitPage({
      url: getBaseUrl(),
      index: INDEX,
      size: 100,
      logger: "com.example.Cache & Cache",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.logger).toBe("com.example.Cache");
    expect(result.hasMore).toBe(false);
  });

  it("pagination - all docs retrieved across multiple pages", async () => {
    const messages = await collectAllMessages({
      url: getBaseUrl(),
      index: INDEX,
      sort: "asc",
    });

    expect(messages).toHaveLength(DOCS.length);
    // Every document message must appear exactly once
    for (const doc of DOCS) {
      expect(messages).toContain(doc.message);
    }
  });
}

describe("Elasticsearch 8.x integration (PIT)", () => {
  let container: StartedTestContainer | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    container = await new GenericContainer(
      "docker.elastic.co/elasticsearch/elasticsearch:8.13.4",
    )
      .withEnvironment({
        "discovery.type": "single-node",
        "xpack.security.enabled": "false",
        ES_JAVA_OPTS: "-Xms512m -Xmx512m",
      })
      .withExposedPorts(9200)
      .withWaitStrategy(
        Wait.forHttp(
          "/_cluster/health?wait_for_status=yellow&timeout=60s",
          9200,
        ).withStartupTimeout(180_000),
      )
      .withStartupTimeout(180_000)
      .start();

    baseUrl = `http://127.0.0.1:${container.getMappedPort(9200)}`;
    await setupIndex(baseUrl, 8);
  }, 200_000);

  afterAll(async () => {
    if (container) await container.stop({ timeout: 10_000 });
  });

  runSharedTests(() => baseUrl);
});

describe("OpenSearch 2.x integration (PIT)", () => {
  let container: StartedTestContainer | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    container = await new GenericContainer(
      "opensearchproject/opensearch:2.13.0",
    )
      .withEnvironment({
        "discovery.type": "single-node",
        DISABLE_SECURITY_PLUGIN: "true",
        OPENSEARCH_JAVA_OPTS: "-Xms512m -Xmx512m",
      })
      .withExposedPorts(9200)
      .withWaitStrategy(
        Wait.forHttp(
          "/_cluster/health?wait_for_status=yellow&timeout=60s",
          9200,
        ).withStartupTimeout(180_000),
      )
      .withStartupTimeout(180_000)
      .start();

    baseUrl = `http://127.0.0.1:${container.getMappedPort(9200)}`;
    await setupIndex(baseUrl, 7);
  }, 200_000);

  afterAll(async () => {
    if (container) await container.stop({ timeout: 10_000 });
  });

  runSharedTests(() => baseUrl);
});

// Suite: Elasticsearch 6.8  (scroll pagination)
//
// ES 6.8 has no arm64 Docker image.  The suite is unconditionally skipped on
// arm64 hosts with an explanatory message.  On amd64 the test validates that
// fetchElasticPitPage transparently falls back to scroll for pre-7.10 clusters
// (same query builder, different pagination transport).
describe.skipIf(IS_ARM64)(
  "Elasticsearch 6.8 integration (scroll, amd64 only)",
  () => {
    let container: StartedTestContainer | null = null;
    let baseUrl = "";

    beforeAll(async () => {
      container = await new GenericContainer(
        "docker.elastic.co/elasticsearch/elasticsearch:6.8.23",
      )
        .withEnvironment({
          "discovery.type": "single-node",
          ES_JAVA_OPTS: "-Xms256m -Xmx256m",
        })
        .withExposedPorts(9200)
        .withWaitStrategy(
          Wait.forHttp(
            "/_cluster/health?wait_for_status=yellow&timeout=60s",
            9200,
          ).withStartupTimeout(180_000),
        )
        .withStartupTimeout(180_000)
        .start();

      baseUrl = `http://127.0.0.1:${container.getMappedPort(9200)}`;
      await setupIndex(baseUrl, 6);
    }, 200_000);

    afterAll(async () => {
      if (container) await container.stop({ timeout: 10_000 });
    });

    // ES 6.8 uses scroll; fetchElasticPitPage detects version and falls back.
    runSharedTests(() => baseUrl);

    it("dialect detection - uses scroll, not PIT", async () => {
      // Fetch one page; scroll mode never returns nextSearchAfter
      const page = await fetchElasticPitPage({
        url: baseUrl,
        index: INDEX,
        size: 100,
      });

      expect(page.entries.length).toBeGreaterThan(0);
      // Scroll mode always returns null for nextSearchAfter
      expect(page.nextSearchAfter).toBeNull();
    });
  },
);
