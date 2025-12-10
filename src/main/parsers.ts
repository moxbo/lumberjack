// Lightweight log parser utilities for main process and tests
// Supports: .log (text or JSONL), .json (array or JSONL), .zip (containing .log/.json)

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import https from "https";
import http from "http";
import log from "electron-log/main";
import zlib from "zlib";

// Keep-Alive Agents für HTTP/HTTPS (inkl. unsicherem TLS)
const HTTP_KEEPALIVE_AGENT = new http.Agent({ keepAlive: true, maxSockets: 8 });
const HTTPS_KEEPALIVE_AGENT = new https.Agent({ keepAlive: true });
const HTTPS_INSECURE_KEEPALIVE_AGENT = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

// Types
type AnyMap = Record<string, unknown>;
export interface Entry {
  timestamp: string | null;
  level: string | null;
  logger: string | null;
  thread: string | null;
  message: string;
  traceId: string | null;
  stackTrace: string | null;
  raw: unknown;
  source: string;
  // optional UI hints used elsewhere
  _mark?: string;
  mdc?: Record<string, string>;
  service?: string;
}

// AdmZip lazy
type AdmZipConstructor = new (filePath?: string | Buffer) => AdmZipInstance;
interface AdmZipInstance {
  getEntries(): AdmZipEntry[];
}
interface AdmZipEntry {
  entryName: string;
  isDirectory: boolean;
  getData(): Buffer;
}
let AdmZip: AdmZipConstructor | null = null;
function getAdmZip(): AdmZipConstructor {
  if (!AdmZip) {
    try {
      AdmZip = require("adm-zip") as AdmZipConstructor;
    } catch {
      const req = createRequire(path.join(process.cwd(), "package.json"));
      AdmZip = req("adm-zip") as AdmZipConstructor;
    }
  }
  return AdmZip;
}

// Safe string helpers
function safeString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  return fallback;
}

function toOptionalString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    if (typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    return null;
  } catch {
    return null;
  }
}
function toStringOr(v: unknown, def: string): string {
  const s = toOptionalString(v);
  return s == null ? def : s;
}

// Normalize one entry into a standard object
function toEntry(obj: AnyMap = {}, fallbackMessage = "", source = ""): Entry {
  // Normalisiere Stacktrace aus gängigen Feldern
  function normalizeStack(o: unknown): string | null {
    if (!o || typeof o !== "object") return null;
    const cand: unknown[] = [];
    try {
      const direct =
        (o as AnyMap).stack_trace ||
        (o as AnyMap).stackTrace ||
        (o as AnyMap).stacktrace;
      if (direct != null) cand.push(direct);
    } catch {
      // Intentionally empty - ignore errors
    }
    try {
      const err = (o as AnyMap).error || (o as AnyMap).err;
      if (err) {
        if ((err as AnyMap).stack != null) cand.push((err as AnyMap).stack);
        if ((err as AnyMap).trace != null) cand.push((err as AnyMap).trace);
        if (typeof err === "string") cand.push(err);
      }
    } catch {
      // Intentionally empty - ignore errors
    }
    try {
      const ex =
        (o as AnyMap).exception ||
        (o as AnyMap).cause ||
        (o as AnyMap).throwable;
      if (ex) {
        if ((ex as AnyMap).stack != null) cand.push((ex as AnyMap).stack);
        if ((ex as AnyMap).stackTrace != null)
          cand.push((ex as AnyMap).stackTrace);
        if (typeof ex === "string") cand.push(ex);
      }
    } catch {
      // Intentionally empty - ignore errors
    }
    try {
      if ((o as AnyMap)["exception.stacktrace"] != null)
        cand.push((o as AnyMap)["exception.stacktrace"]);
      if ((o as AnyMap)["error.stacktrace"] != null)
        cand.push((o as AnyMap)["error.stacktrace"]);
    } catch {
      // Intentionally empty - ignore errors
    }
    for (const v of cand) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const s = v.map((x) => safeString(x)).join("\n");
        if (s.trim()) return s;
      } else {
        const s = safeString(v);
        if (s.trim()) return s;
      }
    }
    return null;
  }

  const stackTrace = normalizeStack(obj);
  const tsVal = obj.timestamp ?? obj["@timestamp"] ?? obj.time;
  const lvlVal = obj.level ?? obj.severity ?? obj.loglevel;
  const loggerVal = obj.logger ?? obj.logger_name ?? obj.category;
  const threadVal = obj.thread ?? obj.thread_name;
  const msgVal = obj.message ?? obj.msg ?? obj.log ?? fallbackMessage ?? "";
  const traceVal =
    obj.traceId ?? obj.trace_id ?? obj.trace ?? obj["trace.id"] ?? obj.TraceID;

  return {
    timestamp: toOptionalString(tsVal),
    level: toOptionalString(lvlVal),
    logger: toOptionalString(loggerVal),
    thread: toOptionalString(threadVal),
    message: toStringOr(msgVal, ""),
    traceId: toOptionalString(traceVal),
    stackTrace: stackTrace || null,
    raw: obj,
    source,
  };
}

function tryParseJson(line: string): AnyMap | null {
  try {
    return JSON.parse(line) as AnyMap;
  } catch {
    return null;
  }
}

// Tolerant KV extractor for malformed JSON-like lines
function tryParseJsonLoose(line: string): AnyMap | null {
  try {
    // Quick check: must look like an object
    const braceStart = line.indexOf("{");
    const braceEnd = line.lastIndexOf("}");
    if (braceStart === -1 || braceEnd === -1 || braceEnd - braceStart < 2)
      return null;
    const slice = line.slice(braceStart, braceEnd + 1);
    const obj: AnyMap = {};
    // Match simple "key":value pairs where value is a JSON string/number/bool/null
    const re =
      /"([^"\\]+)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(slice)) != null) {
      const key: string = m[1] != null ? String(m[1]) : "";
      const rawValStr: string = m[2] != null ? String(m[2]) : "";
      if (!key) continue;
      let val: unknown = null;
      try {
        if (rawValStr.startsWith('"')) {
          // Safely unescape by JSON.parse on the string literal
          val = JSON.parse(rawValStr);
        } else if (rawValStr === "true" || rawValStr === "false") {
          val = rawValStr === "true";
        } else if (rawValStr === "null") {
          val = null;
        } else {
          const n = Number(rawValStr);
          val = Number.isNaN(n) ? rawValStr : n;
        }
      } catch {
        val = rawValStr;
      }
      // Only keep first occurrence to avoid bogus duplicates overriding valid ones
      if ((obj as Record<string, unknown>)[key] === undefined) {
        (obj as Record<string, unknown>)[key] = val;
        found++;
      }
    }
    // Heuristic: require at least some meaningful fields or multiple pairs
    const meaningful = [
      "@timestamp",
      "timestamp",
      "level",
      "logger",
      "logger_name",
      "thread",
      "thread_name",
      "TraceID",
      "message",
    ].some((k) => Object.prototype.hasOwnProperty.call(obj, k));
    if (found >= 3 || meaningful) return obj;
    return null;
  } catch {
    return null;
  }
}

function parseTextLines(filename: string, text: string): Entry[] {
  const entries: Entry[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let obj = tryParseJson(line.trim());
    if (!obj) {
      // try to extract {...} json inside line
      const match = line.match(/{[\s\S]*}$/);
      if (match) obj = tryParseJson(match[0]);
    }
    if (!obj) {
      // last resort: tolerant KV scan to salvage structured fields
      obj = tryParseJsonLoose(line.trim()) || null;
    }
    if (obj) {
      entries.push(toEntry(obj, "", filename));
    } else {
      // fallback: plain text line
      // try to parse timestamp like ISO 8601 at the beginning
      let ts: string | null = null;
      const isoMatch = line.match(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[\d]+)?(?:Z|[+-]\d{2}:?\d{2})?/,
      );
      if (isoMatch) ts = isoMatch[0];
      entries.push(toEntry({}, line, filename));
      if (ts) entries[entries.length - 1]!.timestamp = ts;
    }
  }
  return entries;
}

function parseJsonFile(filename: string, text: string): Entry[] {
  // supports JSON array or NDJSON
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr))
        return arr.map((o) =>
          toEntry(
            o && typeof o === "object" ? (o as AnyMap) : {},
            "",
            filename,
          ),
        );
    } catch (e) {
      log.warn(
        "parseJsonFile: JSON array parse failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  // treat as NDJSON
  return parseTextLines(filename, text);
}

function parseZipFile(zipPath: string): Entry[] {
  const ZipClass = getAdmZip();
  const zip = new ZipClass(zipPath);
  const entries: Entry[] = [];
  zip.getEntries().forEach((zEntry: AdmZipEntry) => {
    const name = zEntry.entryName;
    const ext = path.extname(name).toLowerCase();
    if (
      !zEntry.isDirectory &&
      (ext === ".log" || ext === ".json" || ext === ".jsonl" || ext === ".txt")
    ) {
      const text = zEntry.getData().toString("utf8");
      const parsed =
        ext === ".json"
          ? parseJsonFile(name, text)
          : parseTextLines(name, text);
      parsed.forEach((e) => (e.source = `${zipPath}::${name}`));
      entries.push(...parsed);
    }
  });
  return entries;
}

function parsePath(p: string): Entry[] {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) return [];
  const ext = path.extname(p).toLowerCase();
  const text = ext === ".zip" ? null : fs.readFileSync(p, "utf8");
  if (ext === ".zip") return parseZipFile(p);
  if (ext === ".json") return parseJsonFile(p, text as string);
  if (ext === ".jsonl" || ext === ".txt")
    return parseTextLines(p, text as string);
  if (ext === ".log" || !ext) return parseTextLines(p, text as string);
  return [];
}

function parsePaths(paths: string[]): Entry[] {
  const all: Entry[] = [];
  for (const p of paths) {
    try {
      all.push(...parsePath(p));
    } catch (err) {
      // include error as a special entry
      const msg = err instanceof Error ? err.message : String(err);
      all.push(
        toEntry(
          { level: "ERROR", message: `Failed to parse ${p}: ${msg}` },
          "",
          p,
        ),
      );
    }
  }
  return all;
}

// Elasticsearch types
export interface ElasticsearchAuth {
  type: "basic" | "apiKey" | "bearer";
  username?: string;
  password?: string;
  token?: string;
}
export interface ElasticsearchOptions {
  url: string;
  index?: string;
  from?: string | Date;
  to?: string | Date;
  duration?: string;
  logger?: string;
  level?: string;
  message?: string;
  application_name?: string;
  environment?: string;
  // NEW: case handling for environment
  environmentCase?: "original" | "lower" | "upper" | "case-sensitive";
  size?: number;
  sort?: "asc" | "desc";
  auth?: ElasticsearchAuth;
  allowInsecureTLS?: boolean;
  // Pagination: ES search_after token from previous page
  searchAfter?: Array<string | number>;
  // Zusätze für ES6-kompatiblen Query-Body
  dateFormat?: string; // z.B. 'yyyy-MM-dd HH:mm:ss'
  levelValueGte?: number | string; // mappt auf range level_value.gte
}
export interface ElasticsearchPitOptions extends ElasticsearchOptions {
  keepAlive?: string;
  trackTotalHits?: boolean | number;
  sourceIncludes?: string[];
  sourceExcludes?: string[];
  pitSessionId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}

// PIT session state
interface PitSession {
  sessionId: string;
  pitId: string;
  baseUrl: string;
  index: string;
  headers: Record<string, string>;
  allowInsecureTLS?: boolean;
  keepAlive: string;
  lastUsed: number;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  dialect?: "es" | "opensearch" | "scroll";
}
const pitSessions = new Map<string, PitSession>();

// Type alias for HTTP response
type HttpResponse = { status: number; text: string; json: unknown };

// HTTP JSON request with timeout + keep-alive + streaming decompression
async function httpJsonRequest(
  method: "POST" | "DELETE",
  urlStr: string,
  body: unknown,
  headers: Record<string, string>,
  allowInsecureTLS?: boolean,
  timeoutMs?: number,
): Promise<{ status: number; text: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const mod = isHttps ? https : http;
      const opts: http.RequestOptions = {
        method,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        headers: {
          ...(headers || {}),
          "content-type": "application/json",
          "accept-encoding": "gzip, deflate, br",
          Connection: "keep-alive",
        },
        agent: isHttps
          ? allowInsecureTLS
            ? HTTPS_INSECURE_KEEPALIVE_AGENT
            : HTTPS_KEEPALIVE_AGENT
          : HTTP_KEEPALIVE_AGENT,
      };
      const timer =
        typeof timeoutMs === "number" && timeoutMs > 0
          ? setTimeout(() => {
              try {
                req.destroy(new Error("timeout"));
              } catch (e) {
                log.error("httpJsonRequest: timeout destroy error:", e);
              }
            }, timeoutMs)
          : null;
      const req = mod.request(opts, (res: http.IncomingMessage) => {
        // Determine decompression stream based on content-encoding
        const encoding = (res.headers["content-encoding"] || "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;

        try {
          if (encoding === "gzip") {
            stream = res.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            stream = res.pipe(zlib.createInflate());
          } else if (encoding === "br") {
            stream = res.pipe(zlib.createBrotliDecompress());
          }
        } catch (e) {
          log.warn(
            "httpJsonRequest: decompression stream creation failed, using raw stream:",
            e,
          );
          stream = res;
        }

        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          if (timer) clearTimeout(timer);
          const enc = String(
            res.headers["content-encoding"] || "",
          ).toLowerCase();
          const raw = Buffer.concat(chunks);
          let buf: Buffer = raw;
          try {
            if (enc.includes("gzip")) {
              buf = zlib.gunzipSync(raw);
            } else if (enc.includes("deflate")) {
              buf = zlib.inflateSync(raw);
            } else if (
              enc.includes("br") &&
              typeof zlib.brotliDecompressSync === "function"
            ) {
              buf = zlib.brotliDecompressSync(raw);
            }
          } catch (e) {
            // Wenn Dekomprimierung fehlschlägt, verwende Rohdaten
            log.warn(
              "httpJsonRequest: Dekomprimierung fehlgeschlagen:",
              e instanceof Error ? e.message : String(e),
            );
            buf = raw;
          }
          const text = buf.toString("utf8");
          const status = Number(res.statusCode || 0);
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = null;
          }
          resolve({ status, text, json });
        });
        stream.on("error", (err: Error) => {
          if (timer) clearTimeout(timer);
          reject(err);
        });
      });
      req.on("error", (err: Error) => {
        if (timer) clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      const payload = body ? JSON.stringify(body) : "";
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function requestWithRetry(
  exec: () => Promise<{ status: number; text: string; json: unknown }>,
  opts: { maxRetries: number; backoffBaseMs: number },
): Promise<{ status: number; text: string; json: unknown }> {
  let attempt = 0;
  while (true) {
    try {
      const res = await exec();
      const { status } = res;
      if (status >= 200 && status < 300) return res;
      if (status === 429 || (status >= 500 && status < 600)) {
        if (attempt >= opts.maxRetries) return res;
      } else {
        return res;
      }
    } catch (e) {
      if (attempt >= opts.maxRetries) throw e;
    }
    const delay = Math.round(opts.backoffBaseMs * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, delay));
    attempt++;
  }
}

function buildHeadersWithAuth(
  auth?: ElasticsearchAuth,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Lumberjack/1.0 (+https://hhla.de)",
  };
  if (!auth) return headers;
  try {
    if (auth.type === "basic") {
      const u = String(auth.username || "");
      const p = String(auth.password || "");
      headers.Authorization = `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
    } else if (auth.type === "apiKey") {
      headers.Authorization = `ApiKey ${String(auth.token || "")}`;
    } else if (auth.type === "bearer") {
      headers.Authorization = `Bearer ${String(auth.token || "")}`;
    }
  } catch {
    // Intentionally empty - ignore errors
  }
  return headers;
}

function buildSortArray(order: "asc" | "desc" | undefined): AnyMap[] {
  const ord = order ?? "desc";
  return [
    { "@timestamp": { order: ord, unmapped_type: "boolean" } },
    { _id: { order: ord } },
  ];
}

async function tryOpenPitEs(
  baseUrl: string,
  index: string,
  keepAlive: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<string> {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/${encodeURIComponent(idx)}/_pit?keep_alive=${encodeURIComponent(keepAlive)}&ignore_unavailable=true&allow_no_indices=true&expand_wildcards=open`;
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest("POST", url, {}, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (res.status >= 200 && res.status < 300) {
    const id = (res.json as AnyMap | null)?.id;
    if (typeof id === "string" && id) return id;
    throw new Error("PIT open: Keine id im Response");
  }
  throw new Error(
    `ES PIT open failed ${res.status}: ${res.text.slice(0, 800)}`,
  );
}

async function tryOpenPitOs(
  baseUrl: string,
  index: string,
  keepAlive: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<string> {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/_search/point_in_time`;
  const body = {
    index: idx,
    keep_alive: keepAlive,
    expand_wildcards: "open",
    ignore_unavailable: true,
    allow_no_indices: true,
  } as AnyMap;
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (res.status >= 200 && res.status < 300) {
    const id =
      (res.json as AnyMap | null)?.pit_id || (res.json as AnyMap | null)?.id;
    if (typeof id === "string" && id) return id;
    throw new Error("OpenSearch PIT open: Keine pit_id/id im Response");
  }
  throw new Error(
    `OS PIT open failed ${res.status}: ${res.text.slice(0, 800)}`,
  );
}

async function closePitEs(
  baseUrl: string,
  pitId: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<void> {
  const url = `${baseUrl}/_pit/close`;
  const body = { id: pitId };
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(
      `ES PIT close failed ${res.status}: ${res.text.slice(0, 800)}`,
    );
}

async function closePitOs(
  baseUrl: string,
  pitId: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<void> {
  const url = `${baseUrl}/_search/point_in_time`;
  const body = { pit_id: pitId };
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest("DELETE", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(
      `OS PIT close failed ${res.status}: ${res.text.slice(0, 800)}`,
    );
}

async function closePit(
  baseUrl: string,
  pitId: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
  dialect?: "es" | "opensearch",
): Promise<void> {
  if (dialect === "es") {
    try {
      await closePitEs(
        baseUrl,
        pitId,
        headers,
        allowInsecureTLS,
        timeoutMs,
        maxRetries,
        backoffBaseMs,
      );
      return;
    } catch {
      // Intentionally empty - ignore errors
    }
    await closePitOs(
      baseUrl,
      pitId,
      headers,
      allowInsecureTLS,
      timeoutMs,
      maxRetries,
      backoffBaseMs,
    );
    return;
  }
  if (dialect === "opensearch") {
    try {
      await closePitOs(
        baseUrl,
        pitId,
        headers,
        allowInsecureTLS,
        timeoutMs,
        maxRetries,
        backoffBaseMs,
      );
      return;
    } catch {
      // Intentionally empty - ignore errors
    }
    await closePitEs(
      baseUrl,
      pitId,
      headers,
      allowInsecureTLS,
      timeoutMs,
      maxRetries,
      backoffBaseMs,
    );
    return;
  }
  try {
    await closePitEs(
      baseUrl,
      pitId,
      headers,
      allowInsecureTLS,
      timeoutMs,
      maxRetries,
      backoffBaseMs,
    );
    return;
  } catch {
    // Intentionally empty - ignore errors
  }
  await closePitOs(
    baseUrl,
    pitId,
    headers,
    allowInsecureTLS,
    timeoutMs,
    maxRetries,
    backoffBaseMs,
  );
}

function newSessionId(): string {
  const rnd = Math.random().toString(36).slice(2);
  return `pit_${Date.now().toString(36)}_${rnd}`;
}
function normalizeBase(url: string): string {
  return safeString(url).replace(/\/$/, "");
}
function toIsoIfDate(v: unknown): string | undefined {
  if (v == null) return undefined;
  try {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
    const s = safeString(v).trim();
    if (!s) return undefined;
    if (/^\d+$/.test(s)) return new Date(parseInt(s, 10)).toISOString();
    const d = new Date(s);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

function buildElasticSearchBody(opts: ElasticsearchOptions): AnyMap {
  const must: AnyMap[] = [];
  const filter: AnyMap[] = [];

  // Immer match_all gemäß Referenz-Body
  must.push({ match_all: {} } as AnyMap);

  // environment je nach Case-Option
  const rawEnv = String(opts.environment || "").trim();
  if (rawEnv) {
    const mode = opts.environmentCase || "original";
    if (mode === "case-sensitive") {
      // Versuche exakten, nicht-analysierten Abgleich: sowohl environment als auch environment.keyword berücksichtigen
      must.push({
        bool: {
          should: [
            { term: { environment: rawEnv } } as AnyMap,
            { term: { "environment.keyword": rawEnv } } as AnyMap,
          ],
          minimum_should_match: 1,
        },
      } as AnyMap);
    } else if (mode === "lower") {
      must.push({
        match_phrase: { environment: { query: rawEnv.toLowerCase() } },
      } as AnyMap);
    } else if (mode === "upper") {
      must.push({
        match_phrase: { environment: { query: rawEnv.toUpperCase() } },
      } as AnyMap);
    } else {
      must.push({ match_phrase: { environment: { query: rawEnv } } } as AnyMap);
    }
  }

  // application_name als query_string (analyze_wildcard/allow_leading_wildcard)
  const app = String(opts.application_name || "").trim();
  if (app) {
    const q =
      app.includes(" ") || /[\["*?:/()\]{}]/.test(app)
        ? `"${app.replace(/"/g, '\\"')}"`
        : app;
    must.push({
      query_string: {
        query: `application_name:${q}`,
        analyze_wildcard: true,
        allow_leading_wildcard: true,
      },
    } as AnyMap);
  }

  // Weitere Felder optional weiterhin als match_phrase
  const addField = (field: string, value?: string): void => {
    const v = safeString(value).trim();
    if (!v) return;
    must.push({ match_phrase: { [field]: { query: v } } } as AnyMap);
  };
  addField("logger", opts.logger);
  addField("level", opts.level);
  addField("message", opts.message);

  // Zeitbereich – unterstütze explizites Format
  const range: AnyMap = {};
  const dateFormat = (opts as unknown as AnyMap).dateFormat;
  const fmt = safeString(dateFormat).trim();
  const duration = opts.duration;
  if (duration && safeString(duration).trim()) {
    range.gte = `now-${opts.duration}`;
    range.lte = "now";
  } else {
    if (fmt) {
      const fromStr = opts.from != null ? safeString(opts.from) : "";
      const toStr = opts.to != null ? safeString(opts.to) : "";
      if (fromStr) range.gte = fromStr;
      if (toStr) range.lte = toStr;
      if (fromStr || toStr) range.format = fmt;
    } else {
      // epoch millis oder ISO
      const num = (x: unknown): number | null =>
        typeof x === "number"
          ? x
          : /^\d+$/.test(safeString(x))
            ? Number(x)
            : null;
      const fromNum = num(opts.from as unknown);
      const toNum = num(opts.to as unknown);
      if (fromNum != null || toNum != null) {
        if (fromNum != null) range.gte = fromNum;
        if (toNum != null) range.lte = toNum;
        range.format = "epoch_millis";
      } else {
        const from = toIsoIfDate(opts.from as unknown);
        const to = toIsoIfDate(opts.to as unknown);
        if (from) range.gte = from;
        if (to) range.lte = to;
      }
    }
  }
  if (Object.keys(range).length > 0) {
    must.push({ range: { "@timestamp": range } } as AnyMap);
  }

  // Optional: level_value Mindestwert
  const lv = (opts as unknown as AnyMap).levelValueGte;
  if (lv != null && safeString(lv).trim() !== "") {
    must.push({ range: { level_value: { gte: lv } } } as AnyMap);
  }

  return {
    version: true,
    size: opts.size ?? 1000,
    sort: [
      {
        "@timestamp": { order: opts.sort ?? "desc", unmapped_type: "boolean" },
      },
    ],
    query: {
      bool: {
        must,
        filter: filter.length ? filter : [{ match_all: {} }],
        should: [],
        must_not: [],
      },
    },
    _source: { excludes: [] },
    timeout: "30s",
  };
}

function buildQueryBodyWithPit(
  opts: ElasticsearchPitOptions,
  pitId: string,
): AnyMap {
  const baseBody = buildElasticSearchBody({
    ...opts,
    searchAfter: opts.searchAfter,
  });
  baseBody.size = opts.size ?? 1000;
  baseBody.sort = buildSortArray(opts.sort);
  baseBody.pit = { id: pitId, keep_alive: opts.keepAlive ?? "1m" } as AnyMap;
  const inc = Array.isArray(opts.sourceIncludes)
    ? opts.sourceIncludes
    : undefined;
  const exc = Array.isArray(opts.sourceExcludes)
    ? opts.sourceExcludes
    : undefined;
  if (inc || exc)
    baseBody._source = {
      ...(inc ? { includes: inc } : {}),
      ...(exc ? { excludes: exc } : {}),
    } as AnyMap;
  baseBody.track_total_hits =
    opts.trackTotalHits != null ? opts.trackTotalHits : false;
  if (Array.isArray(opts.searchAfter) && opts.searchAfter.length)
    baseBody.search_after = opts.searchAfter;
  return baseBody;
}

async function searchWithPit(
  sess: PitSession,
  body: AnyMap,
): Promise<{ status: number; text: string; json: AnyMap | null }> {
  const url = `${sess.baseUrl}/_search?filter_path=hits.hits._source,hits.hits.sort,hits.total`;
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest(
      "POST",
      url,
      body,
      sess.headers,
      !!sess.allowInsecureTLS,
      sess.timeoutMs,
    );
  const res = await requestWithRetry(exec, {
    maxRetries: sess.maxRetries,
    backoffBaseMs: sess.backoffBaseMs,
  });
  return {
    status: res.status,
    text: res.text,
    json: (res.json as AnyMap) || null,
  };
}

function getOrCreateSessionSyncState(
  opts: ElasticsearchPitOptions,
): PitSession {
  const baseUrl = normalizeBase(opts.url || "");
  if (!baseUrl)
    throw new Error("Elasticsearch URL (opts.url) ist erforderlich");
  const indexRaw = String(opts.index ?? "").trim();
  const index = indexRaw ? indexRaw : "_all";
  const keepAlive = String(opts.keepAlive || "1m");
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs ?? 45000));
  const maxRetries = Math.max(0, Number(opts.maxRetries ?? 4));
  const backoffBaseMs = Math.max(50, Number(opts.backoffBaseMs ?? 300));
  const headers = buildHeadersWithAuth(opts.auth);
  if (opts.pitSessionId && pitSessions.has(opts.pitSessionId)) {
    const existing = pitSessions.get(opts.pitSessionId)!;
    existing.keepAlive = keepAlive;
    existing.lastUsed = Date.now();
    existing.timeoutMs = timeoutMs;
    existing.maxRetries = maxRetries;
    existing.backoffBaseMs = backoffBaseMs;
    existing.allowInsecureTLS = !!opts.allowInsecureTLS;
    return existing;
  }
  const sessionId =
    opts.pitSessionId && !pitSessions.has(opts.pitSessionId)
      ? String(opts.pitSessionId)
      : newSessionId();
  const sess: PitSession = {
    sessionId,
    pitId: "",
    baseUrl,
    index,
    headers,
    allowInsecureTLS: !!opts.allowInsecureTLS,
    keepAlive,
    lastUsed: Date.now(),
    timeoutMs,
    maxRetries,
    backoffBaseMs,
  };
  pitSessions.set(sessionId, sess);
  return sess;
}

async function ensurePitOpened(sess: PitSession): Promise<void> {
  if (sess.pitId) return;
  try {
    sess.pitId = await tryOpenPitEs(
      sess.baseUrl,
      sess.index,
      sess.keepAlive,
      sess.headers,
      sess.allowInsecureTLS,
      sess.timeoutMs,
      sess.maxRetries,
      sess.backoffBaseMs,
    );
    sess.dialect = "es";
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /unrecognized parameter|unknown url|_pit]|\[\/\/_pit|unknown|not found|illegal_argument/i.test(
        msg,
      )
    ) {
      try {
        sess.pitId = await tryOpenPitOs(
          sess.baseUrl,
          sess.index,
          sess.keepAlive,
          sess.headers,
          sess.allowInsecureTLS,
          sess.timeoutMs,
          sess.maxRetries,
          sess.backoffBaseMs,
        );
        sess.dialect = "opensearch";
        return;
      } catch (e2) {
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        if (/security_exception|unauthorized|forbidden|403/.test(m2)) {
          sess.dialect = "scroll";
          return;
        }
        // Generischer Fallback: ältere ES-Versionen (z. B. 6.x) -> Scroll verwenden
        sess.dialect = "scroll";
        return;
      }
    }
    if (/security_exception|unauthorized|forbidden|403/.test(msg)) {
      sess.dialect = "scroll";
      return;
    }
    // Letzte Rettung: Auch hier auf Scroll wechseln, um Suche dennoch zu ermöglichen
    sess.dialect = "scroll";
    return;
  }
}

function parseHitsResponse(
  data: AnyMap | null,
  size: number,
): {
  entries: Entry[];
  total: number | null;
  hasMore: boolean;
  nextSearchAfter: Array<string | number> | null;
} {
  const hitsContainer = (data && data.hits) as AnyMap | undefined;
  const totalVal = (() => {
    const t = hitsContainer && hitsContainer.total;
    if (!t) return null;
    if (typeof t === "number") return t;
    if (typeof t === "object" && typeof (t as AnyMap).value === "number")
      return Number((t as AnyMap).value) || 0;
    return null;
  })();
  const hitsArray =
    hitsContainer && Array.isArray(hitsContainer.hits)
      ? (hitsContainer.hits as unknown[])
      : [];
  const out: Entry[] = [];
  for (const h of hitsArray) {
    const hObj = h && typeof h === "object" ? (h as AnyMap) : {};
    const src = hObj._source ?? hObj.fields ?? {};
    const srcObj = src && typeof src === "object" ? (src as AnyMap) : {};
    const index = hObj._index;
    const id = hObj._id;
    const indexStr = typeof index === "string" ? index : "";
    const idStr = typeof id === "string" ? id : "";
    const e = toEntry(srcObj, "", `elastic://${indexStr}/${idStr}`);
    out.push(e);
  }
  const lastHit =
    hitsArray.length > 0 ? (hitsArray[hitsArray.length - 1] as AnyMap) : null;
  const sortVals =
    lastHit && Array.isArray(lastHit.sort)
      ? (lastHit.sort as Array<string | number>)
      : null;
  const hasMore = hitsArray.length >= (size || 0);
  return {
    entries: out,
    total: totalVal,
    hasMore,
    nextSearchAfter: hasMore && sortVals ? sortVals : null,
  };
}

async function openScroll(
  baseUrl: string,
  index: string,
  keepAlive: string,
  size: number,
  sortOrder: "asc" | "desc" | undefined,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
  queryOpts?: ElasticsearchOptions,
): Promise<{ scrollId: string; entries: Entry[]; total: number | null }> {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/${encodeURIComponent(idx)}/_search?scroll=${encodeURIComponent(keepAlive)}&ignore_unavailable=true&allow_no_indices=true&expand_wildcards=open&filter_path=hits.hits._source,hits.hits.sort,hits.total,_scroll_id`;
  const body = buildElasticSearchBody({
    ...(queryOpts || {}),
    index: idx,
    size,
    sort: sortOrder,
  } as ElasticsearchOptions);
  const exec = () =>
    httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(
      `Scroll open failed ${res.status}: ${res.text.slice(0, 800)}`,
    );
  const j = (res.json as AnyMap) || {};
  const scrollId = (j._scroll_id as string) || (j.scroll_id as string) || "";
  const { entries, total } = parseHitsResponse(j, size);
  if (!scrollId) {
    if (entries.length === 0)
      return { scrollId: "", entries: [], total: total ?? 0 };
    throw new Error("Scroll open: Keine _scroll_id im Response");
  }
  return { scrollId, entries, total };
}

async function scrollNext(
  baseUrl: string,
  keepAlive: string,
  scrollId: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<{ scrollId: string; entries: Entry[] }> {
  const url = `${baseUrl}/_search/scroll?filter_path=hits.hits._source,hits.hits.sort,_scroll_id`;
  const body = { scroll: keepAlive, scroll_id: scrollId } as AnyMap;
  const exec = (): Promise<HttpResponse> =>
    httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(
      `Scroll next failed ${res.status}: ${res.text.slice(0, 800)}`,
    );
  const j = (res.json as AnyMap) || {};
  const newScrollId = (j._scroll_id as string) || (j.scroll_id as string) || "";
  const entries = parseHitsResponse(j, Number.MAX_SAFE_INTEGER).entries;
  if (!newScrollId && entries.length === 0)
    return { scrollId: "", entries: [] };
  if (!newScrollId)
    throw new Error("Scroll next: Keine _scroll_id im Response");
  return { scrollId: newScrollId, entries };
}

async function closeScroll(
  baseUrl: string,
  scrollId: string,
  headers: Record<string, string>,
  allowInsecureTLS: boolean | undefined,
  timeoutMs: number,
  maxRetries: number,
  backoffBaseMs: number,
): Promise<void> {
  if (!scrollId) return;
  const url = `${baseUrl}/_search/scroll`;
  const execPost = async (payload: AnyMap) => {
    const exec = () =>
      httpJsonRequest(
        "POST",
        url,
        payload,
        headers,
        allowInsecureTLS,
        timeoutMs,
      );
    const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
    return res.status >= 200 && res.status < 300;
  };
  const tryDeletePath = async () => {
    const delUrl = `${baseUrl}/_search/scroll/${encodeURIComponent(scrollId)}`;
    const exec = () =>
      httpJsonRequest(
        "DELETE",
        delUrl,
        {},
        headers,
        allowInsecureTLS,
        timeoutMs,
      );
    const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
    return res.status >= 200 && res.status < 300;
  };
  const ok =
    (await execPost({ scroll_id: scrollId } as AnyMap)) ||
    (await execPost({ scroll_id: [scrollId] } as AnyMap)) ||
    (await tryDeletePath());
  if (!ok) {
    log.warn("closeScroll: failed to clear scroll_id");
  }
}

// Öffentliche API: Hole eine Seite via PIT+search_after und verwalte Session
export async function fetchElasticPitPage(
  opts: ElasticsearchPitOptions,
): Promise<{
  entries: Entry[];
  total: number | null;
  hasMore: boolean;
  nextSearchAfter: Array<string | number> | null;
  pitSessionId: string;
}> {
  const sess = getOrCreateSessionSyncState(opts);
  await ensurePitOpened(sess);
  if (sess.dialect === "scroll") {
    let entries: Entry[];
    let total: number | null = null;
    if (!sess.pitId) {
      const first = await openScroll(
        sess.baseUrl,
        sess.index,
        sess.keepAlive,
        opts.size ?? 1000,
        opts.sort,
        sess.headers,
        sess.allowInsecureTLS,
        sess.timeoutMs,
        sess.maxRetries,
        sess.backoffBaseMs,
        opts,
      );
      sess.pitId = first.scrollId;
      entries = first.entries;
      total = first.total;
    } else {
      const next = await scrollNext(
        sess.baseUrl,
        sess.keepAlive,
        sess.pitId,
        sess.headers,
        sess.allowInsecureTLS,
        sess.timeoutMs,
        sess.maxRetries,
        sess.backoffBaseMs,
      );
      sess.pitId = next.scrollId;
      entries = next.entries;
    }
    const hasMore = entries.length > 0;
    sess.lastUsed = Date.now();
    if (!hasMore) {
      try {
        if (sess.pitId)
          await closeScroll(
            sess.baseUrl,
            sess.pitId,
            sess.headers,
            sess.allowInsecureTLS,
            sess.timeoutMs,
            sess.maxRetries,
            sess.backoffBaseMs,
          );
      } catch (e) {
        log.warn(
          "Scroll close after completion failed:",
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        pitSessions.delete(sess.sessionId);
      }
    }
    return {
      entries,
      total,
      hasMore,
      nextSearchAfter: null,
      pitSessionId: sess.sessionId,
    };
  }
  // Query Body bauen und Keep-Alive verlängern
  const body = buildQueryBodyWithPit(
    { ...opts, keepAlive: sess.keepAlive },
    sess.pitId,
  );
  const res = await searchWithPit(sess, body);
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(
      `Elasticsearch-Fehler ${res.status}: ${res.text.slice(0, 1200)}`,
    );
  const { entries, total, hasMore, nextSearchAfter } = parseHitsResponse(
    (res.json as AnyMap) || null,
    opts.size ?? 1000,
  );
  sess.lastUsed = Date.now();
  // Wenn keine weiteren Treffer: Session hier schließen (sauberes Lifecycle)
  if (!hasMore) {
    try {
      await closePit(
        sess.baseUrl,
        sess.pitId,
        sess.headers,
        sess.allowInsecureTLS,
        sess.timeoutMs,
        sess.maxRetries,
        sess.backoffBaseMs,
        sess.dialect,
      );
    } catch (e) {
      log.warn(
        "PIT close after completion failed:",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      pitSessions.delete(sess.sessionId);
    }
  }
  return {
    entries,
    total,
    hasMore,
    nextSearchAfter,
    pitSessionId: sess.sessionId,
  };
}

// Öffentliche API: Session explizit schließen
export async function closeElasticPitSession(sessionId: string): Promise<void> {
  try {
    if (!sessionId) return;
    const sess = pitSessions.get(sessionId);
    if (!sess) return;
    if (sess.pitId) {
      try {
        if (sess.dialect === "scroll") {
          await closeScroll(
            sess.baseUrl,
            sess.pitId,
            sess.headers,
            sess.allowInsecureTLS,
            sess.timeoutMs,
            sess.maxRetries,
            sess.backoffBaseMs,
          );
        } else {
          await closePit(
            sess.baseUrl,
            sess.pitId,
            sess.headers,
            sess.allowInsecureTLS,
            sess.timeoutMs,
            sess.maxRetries,
            sess.backoffBaseMs,
            sess.dialect,
          );
        }
      } catch (e) {
        log.warn(
          "PIT/Scroll close failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  } finally {
    pitSessions.delete(sessionId);
  }
}

export { parsePaths, parseTextLines, parseJsonFile, parseZipFile, toEntry };
