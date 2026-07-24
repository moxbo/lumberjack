import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";
import { fetchElasticPitPage } from "../parsers";

describe("Elasticsearch 6 pagination", () => {
  let server: http.Server;
  let baseUrl: string;
  const requests: Array<{ method: string; url: string; body: unknown }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: req.method || "",
          url: req.url || "",
          body: raw ? JSON.parse(raw) : undefined,
        });
        res.setHeader("content-type", "application/json");

        if (req.method === "GET") {
          res.end(JSON.stringify({ version: { number: "6.8.23" } }));
          return;
        }
        if (req.url?.startsWith("/_search/scroll")) {
          res.end(JSON.stringify({ succeeded: true }));
          return;
        }
        if (req.url?.startsWith("/empty/_search")) {
          res.end(JSON.stringify({ hits: { total: 0, hits: [] } }));
          return;
        }

        res.end(
          JSON.stringify({
            _scroll_id: "scroll-1",
            hits: {
              total: 2,
              hits: [
                {
                  _index: "logs",
                  _id: "1",
                  _source: {
                    "@timestamp": "2026-01-01T00:00:00.000Z",
                    message: "one",
                  },
                },
                {
                  _index: "logs",
                  _id: "2",
                  _source: {
                    "@timestamp": "2026-01-01T00:00:01.000Z",
                    message: "two",
                  },
                },
              ],
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("detects ES 6 once, uses scroll directly and avoids an empty final page", async () => {
    const empty = await fetchElasticPitPage({
      url: baseUrl,
      index: "empty",
      size: 100,
    });
    const complete = await fetchElasticPitPage({
      url: baseUrl,
      index: "logs",
      size: 100,
      logger: "com.example.Service",
    });

    expect(empty).toMatchObject({ entries: [], total: 0, hasMore: false });
    expect(complete).toMatchObject({ total: 2, hasMore: false });
    expect(complete.entries).toHaveLength(2);
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(
      1,
    );
    expect(requests.some((request) => request.url.includes("_pit"))).toBe(
      false,
    );
    expect(
      requests.some((request) => request.url.includes("point_in_time")),
    ).toBe(false);
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" &&
          request.url.startsWith("/_search/scroll"),
      ),
    ).toHaveLength(1);

    const searchBody = requests.find((request) =>
      request.url.startsWith("/logs/_search"),
    )?.body as Record<string, unknown>;
    expect(searchBody.version).toBeUndefined();
    expect(searchBody).toMatchObject({
      query: {
        bool: {
          must: [
            { match_all: {} },
            {
              match_phrase: {
                logger_name: { query: "com.example.Service" },
              },
            },
          ],
        },
      },
    });
  });
});
