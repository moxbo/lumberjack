"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var parsers_exports = {};
__export(parsers_exports, {
  closeElasticPitSession: () => closeElasticPitSession,
  fetchElasticPitPage: () => fetchElasticPitPage,
  parseJsonFile: () => parseJsonFile,
  parsePaths: () => parsePaths,
  parseTextLines: () => parseTextLines,
  parseZipFile: () => parseZipFile,
  toEntry: () => toEntry
});
module.exports = __toCommonJS(parsers_exports);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_module = require("module");
var import_https = __toESM(require("https"), 1);
var import_http = __toESM(require("http"), 1);
var import_main = __toESM(require("electron-log/main"), 1);
const HTTP_KEEPALIVE_AGENT = new import_http.default.Agent({ keepAlive: true, maxSockets: 8 });
const HTTPS_KEEPALIVE_AGENT = new import_https.default.Agent({ keepAlive: true });
const HTTPS_INSECURE_KEEPALIVE_AGENT = new import_https.default.Agent({
  keepAlive: true,
  rejectUnauthorized: false
});
let AdmZip = null;
function getAdmZip() {
  if (!AdmZip) {
    try {
      AdmZip = require("adm-zip");
    } catch (e) {
      const req = (0, import_module.createRequire)(import_path.default.join(process.cwd(), "package.json"));
      AdmZip = req("adm-zip");
    }
  }
  return AdmZip;
}
function safeString(v, fallback = "") {
  if (v == null) return fallback;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return fallback;
}
function toOptionalString(v) {
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
function toStringOr(v, def) {
  const s = toOptionalString(v);
  return s == null ? def : s;
}
function toEntry(obj = {}, fallbackMessage = "", source = "") {
  function normalizeStack(o) {
    if (!o || typeof o !== "object") return null;
    const cand = [];
    try {
      const direct = o.stack_trace || o.stackTrace || o.stacktrace;
      if (direct != null) cand.push(direct);
    } catch {
    }
    try {
      const err = o.error || o.err;
      if (err) {
        if (err.stack != null) cand.push(err.stack);
        if (err.trace != null) cand.push(err.trace);
        if (typeof err === "string") cand.push(err);
      }
    } catch {
    }
    try {
      const ex = o.exception || o.cause || o.throwable;
      if (ex) {
        if (ex.stack != null) cand.push(ex.stack);
        if (ex.stackTrace != null) cand.push(ex.stackTrace);
        if (typeof ex === "string") cand.push(ex);
      }
    } catch {
    }
    try {
      if (o["exception.stacktrace"] != null)
        cand.push(o["exception.stacktrace"]);
      if (o["error.stacktrace"] != null) cand.push(o["error.stacktrace"]);
    } catch {
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
  const traceVal = obj.traceId ?? obj.trace_id ?? obj.trace ?? obj["trace.id"] ?? obj.TraceID;
  return {
    timestamp: toOptionalString(tsVal),
    level: toOptionalString(lvlVal),
    logger: toOptionalString(loggerVal),
    thread: toOptionalString(threadVal),
    message: toStringOr(msgVal, ""),
    traceId: toOptionalString(traceVal),
    stackTrace: stackTrace || null,
    raw: obj,
    source
  };
}
function tryParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function parseTextLines(filename, text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let obj = tryParseJson(line.trim());
    if (!obj) {
      const match = line.match(/{[\s\S]*}$/);
      if (match) obj = tryParseJson(match[0]);
    }
    if (obj) {
      entries.push(toEntry(obj, "", filename));
    } else {
      let ts = null;
      const isoMatch = line.match(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[\d]+)?(?:Z|[+-]\d{2}:?\d{2})?/
      );
      if (isoMatch) ts = isoMatch[0];
      entries.push(toEntry({}, line, filename));
      if (ts) entries[entries.length - 1].timestamp = ts;
    }
  }
  return entries;
}
function parseJsonFile(filename, text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr))
        return arr.map(
          (o) => toEntry(o && typeof o === "object" ? o : {}, "", filename)
        );
    } catch (e) {
      import_main.default.warn(
        "parseJsonFile: JSON array parse failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }
  return parseTextLines(filename, text);
}
function parseZipFile(zipPath) {
  const ZipClass = getAdmZip();
  const zip = new ZipClass(zipPath);
  const entries = [];
  zip.getEntries().forEach((zEntry) => {
    const name = zEntry.entryName;
    const ext = import_path.default.extname(name).toLowerCase();
    if (!zEntry.isDirectory && (ext === ".log" || ext === ".json" || ext === ".jsonl" || ext === ".txt")) {
      const text = zEntry.getData().toString("utf8");
      const parsed = ext === ".json" ? parseJsonFile(name, text) : parseTextLines(name, text);
      parsed.forEach((e) => e.source = `${zipPath}::${name}`);
      entries.push(...parsed);
    }
  });
  return entries;
}
function parsePath(p) {
  const stat = import_fs.default.statSync(p);
  if (stat.isDirectory()) return [];
  const ext = import_path.default.extname(p).toLowerCase();
  const text = ext === ".zip" ? null : import_fs.default.readFileSync(p, "utf8");
  if (ext === ".zip") return parseZipFile(p);
  if (ext === ".json") return parseJsonFile(p, text);
  if (ext === ".jsonl" || ext === ".txt") return parseTextLines(p, text);
  if (ext === ".log" || !ext) return parseTextLines(p, text);
  return [];
}
function parsePaths(paths) {
  const all = [];
  for (const p of paths) {
    try {
      all.push(...parsePath(p));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      all.push(toEntry({ level: "ERROR", message: `Failed to parse ${p}: ${msg}` }, "", p));
    }
  }
  return all;
}
const pitSessions = /* @__PURE__ */ new Map();
async function httpJsonRequest(method, urlStr, body, headers, allowInsecureTLS, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const mod = isHttps ? import_https.default : import_http.default;
      const opts = {
        method,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        headers: {
          ...headers || {},
          "content-type": "application/json",
          Connection: "keep-alive"
        },
        agent: isHttps ? allowInsecureTLS ? HTTPS_INSECURE_KEEPALIVE_AGENT : HTTPS_KEEPALIVE_AGENT : HTTP_KEEPALIVE_AGENT
      };
      const timer = typeof timeoutMs === "number" && timeoutMs > 0 ? setTimeout(() => {
        try {
          req.destroy(new Error("timeout"));
        } catch (e) {
          import_main.default.error("httpJsonRequest: timeout destroy error:", e);
        }
      }, timeoutMs) : null;
      const req = mod.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (timer) clearTimeout(timer);
          const text = Buffer.concat(chunks).toString("utf8");
          const status = Number(res.statusCode || 0);
          let json = null;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = null;
          }
          resolve({ status, text, json });
        });
      });
      req.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      const payload = body ? JSON.stringify(body) : "";
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
async function requestWithRetry(exec, opts) {
  let attempt = 0;
  while (true) {
    try {
      const res = await exec();
      const { status } = res;
      if (status >= 200 && status < 300) return res;
      if (status === 429 || status >= 500 && status < 600) {
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
function buildHeadersWithAuth(auth) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Lumberjack/1.0 (+https://hhla.de)"
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
  }
  return headers;
}
function buildSortArray(order) {
  const ord = order ?? "desc";
  return [{ "@timestamp": { order: ord, unmapped_type: "boolean" } }, { _id: { order: ord } }];
}
async function tryOpenPitEs(baseUrl, index, keepAlive, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/${encodeURIComponent(idx)}/_pit?keep_alive=${encodeURIComponent(keepAlive)}&ignore_unavailable=true&allow_no_indices=true&expand_wildcards=open`;
  const exec = () => httpJsonRequest("POST", url, {}, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (res.status >= 200 && res.status < 300) {
    const id = res.json?.id;
    if (typeof id === "string" && id) return id;
    throw new Error("PIT open: Keine id im Response");
  }
  throw new Error(`ES PIT open failed ${res.status}: ${res.text.slice(0, 800)}`);
}
async function tryOpenPitOs(baseUrl, index, keepAlive, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/_search/point_in_time`;
  const body = {
    index: idx,
    keep_alive: keepAlive,
    expand_wildcards: "open",
    ignore_unavailable: true,
    allow_no_indices: true
  };
  const exec = () => httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (res.status >= 200 && res.status < 300) {
    const id = res.json?.pit_id || res.json?.id;
    if (typeof id === "string" && id) return id;
    throw new Error("OpenSearch PIT open: Keine pit_id/id im Response");
  }
  throw new Error(`OS PIT open failed ${res.status}: ${res.text.slice(0, 800)}`);
}
async function closePitEs(baseUrl, pitId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  const url = `${baseUrl}/_pit/close`;
  const body = { id: pitId };
  const exec = () => httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(`ES PIT close failed ${res.status}: ${res.text.slice(0, 800)}`);
}
async function closePitOs(baseUrl, pitId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  const url = `${baseUrl}/_search/point_in_time`;
  const body = { pit_id: pitId };
  const exec = () => httpJsonRequest("DELETE", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(`OS PIT close failed ${res.status}: ${res.text.slice(0, 800)}`);
}
async function closePit(baseUrl, pitId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs, dialect) {
  if (dialect === "es") {
    try {
      await closePitEs(
        baseUrl,
        pitId,
        headers,
        allowInsecureTLS,
        timeoutMs,
        maxRetries,
        backoffBaseMs
      );
      return;
    } catch {
    }
    await closePitOs(
      baseUrl,
      pitId,
      headers,
      allowInsecureTLS,
      timeoutMs,
      maxRetries,
      backoffBaseMs
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
        backoffBaseMs
      );
      return;
    } catch {
    }
    await closePitEs(
      baseUrl,
      pitId,
      headers,
      allowInsecureTLS,
      timeoutMs,
      maxRetries,
      backoffBaseMs
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
      backoffBaseMs
    );
    return;
  } catch {
  }
  await closePitOs(baseUrl, pitId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs);
}
function newSessionId() {
  const rnd = Math.random().toString(36).slice(2);
  return `pit_${Date.now().toString(36)}_${rnd}`;
}
function normalizeBase(url) {
  return safeString(url).replace(/\/$/, "");
}
function toIsoIfDate(v) {
  if (v == null) return void 0;
  try {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
    const s = safeString(v).trim();
    if (!s) return void 0;
    if (/^\d+$/.test(s)) return new Date(parseInt(s, 10)).toISOString();
    const d = new Date(s);
    if (isNaN(d.getTime())) return void 0;
    return d.toISOString();
  } catch {
    return void 0;
  }
}
function buildElasticSearchBody(opts) {
  const must = [];
  const filter = [];
  must.push({ match_all: {} });
  const rawEnv = String(opts.environment || "").trim();
  if (rawEnv) {
    const mode = opts.environmentCase || "original";
    if (mode === "case-sensitive") {
      must.push({
        bool: {
          should: [
            { term: { environment: rawEnv } },
            { term: { "environment.keyword": rawEnv } }
          ],
          minimum_should_match: 1
        }
      });
    } else if (mode === "lower") {
      must.push({ match_phrase: { environment: { query: rawEnv.toLowerCase() } } });
    } else if (mode === "upper") {
      must.push({ match_phrase: { environment: { query: rawEnv.toUpperCase() } } });
    } else {
      must.push({ match_phrase: { environment: { query: rawEnv } } });
    }
  }
  const app = String(opts.application_name || "").trim();
  if (app) {
    const q = app.includes(" ") || /["*?:\\/()\[\]{}]/.test(app) ? `"${app.replace(/"/g, '\\"')}"` : app;
    must.push({
      query_string: {
        query: `application_name:${q}`,
        analyze_wildcard: true,
        allow_leading_wildcard: true
      }
    });
  }
  const addField = (field, value) => {
    const v = safeString(value).trim();
    if (!v) return;
    must.push({ match_phrase: { [field]: { query: v } } });
  };
  addField("logger", opts.logger);
  addField("level", opts.level);
  addField("message", opts.message);
  const range = {};
  const dateFormat = opts.dateFormat;
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
      const num = (x) => typeof x === "number" ? x : /^\d+$/.test(safeString(x)) ? Number(x) : null;
      const fromNum = num(opts.from);
      const toNum = num(opts.to);
      if (fromNum != null || toNum != null) {
        if (fromNum != null) range.gte = fromNum;
        if (toNum != null) range.lte = toNum;
        range.format = "epoch_millis";
      } else {
        const from = toIsoIfDate(opts.from);
        const to = toIsoIfDate(opts.to);
        if (from) range.gte = from;
        if (to) range.lte = to;
      }
    }
  }
  if (Object.keys(range).length > 0) {
    must.push({ range: { "@timestamp": range } });
  }
  const lv = opts.levelValueGte;
  if (lv != null && safeString(lv).trim() !== "") {
    must.push({ range: { level_value: { gte: lv } } });
  }
  const body = {
    version: true,
    size: opts.size ?? 1e3,
    sort: [{ "@timestamp": { order: opts.sort ?? "desc", unmapped_type: "boolean" } }],
    query: {
      bool: {
        must,
        filter: filter.length ? filter : [{ match_all: {} }],
        should: [],
        must_not: []
      }
    },
    _source: { excludes: [] },
    timeout: "30s"
  };
  return body;
}
function buildQueryBodyWithPit(opts, pitId) {
  const baseBody = buildElasticSearchBody({ ...opts, searchAfter: opts.searchAfter });
  baseBody.size = opts.size ?? 1e3;
  baseBody.sort = buildSortArray(opts.sort);
  baseBody.pit = { id: pitId, keep_alive: opts.keepAlive ?? "1m" };
  const inc = Array.isArray(opts.sourceIncludes) ? opts.sourceIncludes : void 0;
  const exc = Array.isArray(opts.sourceExcludes) ? opts.sourceExcludes : void 0;
  if (inc || exc)
    baseBody._source = {
      ...inc ? { includes: inc } : {},
      ...exc ? { excludes: exc } : {}
    };
  baseBody.track_total_hits = opts.trackTotalHits != null ? opts.trackTotalHits : false;
  if (Array.isArray(opts.searchAfter) && opts.searchAfter.length)
    baseBody.search_after = opts.searchAfter;
  return baseBody;
}
async function searchWithPit(sess, body) {
  const url = `${sess.baseUrl}/_search?filter_path=hits.hits._source,hits.hits.sort,hits.total`;
  const exec = () => httpJsonRequest("POST", url, body, sess.headers, !!sess.allowInsecureTLS, sess.timeoutMs);
  const res = await requestWithRetry(exec, {
    maxRetries: sess.maxRetries,
    backoffBaseMs: sess.backoffBaseMs
  });
  return { status: res.status, text: res.text, json: res.json || null };
}
function getOrCreateSessionSyncState(opts) {
  const baseUrl = normalizeBase(opts.url || "");
  if (!baseUrl) throw new Error("Elasticsearch URL (opts.url) ist erforderlich");
  const indexRaw = String(opts.index ?? "").trim();
  const index = indexRaw ? indexRaw : "_all";
  const keepAlive = String(opts.keepAlive || "1m");
  const timeoutMs = Math.max(1e3, Number(opts.timeoutMs ?? 45e3));
  const maxRetries = Math.max(0, Number(opts.maxRetries ?? 4));
  const backoffBaseMs = Math.max(50, Number(opts.backoffBaseMs ?? 300));
  const headers = buildHeadersWithAuth(opts.auth);
  if (opts.pitSessionId && pitSessions.has(opts.pitSessionId)) {
    const existing = pitSessions.get(opts.pitSessionId);
    existing.keepAlive = keepAlive;
    existing.lastUsed = Date.now();
    existing.timeoutMs = timeoutMs;
    existing.maxRetries = maxRetries;
    existing.backoffBaseMs = backoffBaseMs;
    existing.allowInsecureTLS = !!opts.allowInsecureTLS;
    return existing;
  }
  const sessionId = opts.pitSessionId && !pitSessions.has(opts.pitSessionId) ? String(opts.pitSessionId) : newSessionId();
  const sess = {
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
    backoffBaseMs
  };
  pitSessions.set(sessionId, sess);
  return sess;
}
async function ensurePitOpened(sess) {
  if (sess.pitId) return;
  try {
    const id = await tryOpenPitEs(
      sess.baseUrl,
      sess.index,
      sess.keepAlive,
      sess.headers,
      sess.allowInsecureTLS,
      sess.timeoutMs,
      sess.maxRetries,
      sess.backoffBaseMs
    );
    sess.pitId = id;
    sess.dialect = "es";
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unrecognized parameter|unknown url|_pit\]|\[\/\/_pit|unknown|not found|illegal_argument/i.test(
      msg
    )) {
      try {
        const id = await tryOpenPitOs(
          sess.baseUrl,
          sess.index,
          sess.keepAlive,
          sess.headers,
          sess.allowInsecureTLS,
          sess.timeoutMs,
          sess.maxRetries,
          sess.backoffBaseMs
        );
        sess.pitId = id;
        sess.dialect = "opensearch";
        return;
      } catch (e2) {
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        if (/security_exception|unauthorized|forbidden|403/.test(m2)) {
          sess.dialect = "scroll";
          return;
        }
        sess.dialect = "scroll";
        return;
      }
    }
    if (/security_exception|unauthorized|forbidden|403/.test(msg)) {
      sess.dialect = "scroll";
      return;
    }
    sess.dialect = "scroll";
    return;
  }
}
function parseHitsResponse(data, size) {
  const hitsContainer = data && data.hits;
  const totalVal = (() => {
    const t = hitsContainer && hitsContainer.total;
    if (!t) return null;
    if (typeof t === "number") return t;
    if (typeof t === "object" && typeof t.value === "number")
      return Number(t.value) || 0;
    return null;
  })();
  const hitsArray = hitsContainer && Array.isArray(hitsContainer.hits) ? hitsContainer.hits : [];
  const out = [];
  for (const h of hitsArray) {
    const hObj = h && typeof h === "object" ? h : {};
    const src = hObj._source ?? hObj.fields ?? {};
    const srcObj = src && typeof src === "object" ? src : {};
    const index = hObj._index;
    const id = hObj._id;
    const indexStr = typeof index === "string" ? index : "";
    const idStr = typeof id === "string" ? id : "";
    const e = toEntry(srcObj, "", `elastic://${indexStr}/${idStr}`);
    out.push(e);
  }
  const lastHit = hitsArray.length > 0 ? hitsArray[hitsArray.length - 1] : null;
  const sortVals = lastHit && Array.isArray(lastHit.sort) ? lastHit.sort : null;
  const hasMore = hitsArray.length >= (size || 0);
  return {
    entries: out,
    total: totalVal,
    hasMore,
    nextSearchAfter: hasMore && sortVals ? sortVals : null
  };
}
async function openScroll(baseUrl, index, keepAlive, size, sortOrder, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs, queryOpts) {
  const idx = index && index.trim() ? index.trim() : "_all";
  const url = `${baseUrl}/${encodeURIComponent(idx)}/_search?scroll=${encodeURIComponent(keepAlive)}&ignore_unavailable=true&allow_no_indices=true&expand_wildcards=open&filter_path=hits.hits._source,hits.hits.sort,hits.total,_scroll_id`;
  const body = buildElasticSearchBody({
    ...queryOpts || {},
    index: idx,
    size,
    sort: sortOrder
  });
  const exec = () => httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(`Scroll open failed ${res.status}: ${res.text.slice(0, 800)}`);
  const j = res.json || {};
  const scrollId = j._scroll_id || j.scroll_id || "";
  const { entries, total } = parseHitsResponse(j, size);
  if (!scrollId) {
    if (entries.length === 0) return { scrollId: "", entries: [], total: total ?? 0 };
    throw new Error("Scroll open: Keine _scroll_id im Response");
  }
  return { scrollId, entries, total };
}
async function scrollNext(baseUrl, keepAlive, scrollId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  const url = `${baseUrl}/_search/scroll?filter_path=hits.hits._source,hits.hits.sort,_scroll_id`;
  const body = { scroll: keepAlive, scroll_id: scrollId };
  const exec = () => httpJsonRequest("POST", url, body, headers, allowInsecureTLS, timeoutMs);
  const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(`Scroll next failed ${res.status}: ${res.text.slice(0, 800)}`);
  const j = res.json || {};
  const newScrollId = j._scroll_id || j.scroll_id || "";
  const entries = parseHitsResponse(j, Number.MAX_SAFE_INTEGER).entries;
  if (!newScrollId && entries.length === 0) return { scrollId: "", entries: [] };
  if (!newScrollId) throw new Error("Scroll next: Keine _scroll_id im Response");
  return { scrollId: newScrollId, entries };
}
async function closeScroll(baseUrl, scrollId, headers, allowInsecureTLS, timeoutMs, maxRetries, backoffBaseMs) {
  if (!scrollId) return;
  const url = `${baseUrl}/_search/scroll`;
  const execPost = async (payload) => {
    const exec = () => httpJsonRequest("POST", url, payload, headers, allowInsecureTLS, timeoutMs);
    const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
    return res.status >= 200 && res.status < 300;
  };
  const tryDeletePath = async () => {
    const delUrl = `${baseUrl}/_search/scroll/${encodeURIComponent(scrollId)}`;
    const exec = () => httpJsonRequest("DELETE", delUrl, {}, headers, allowInsecureTLS, timeoutMs);
    const res = await requestWithRetry(exec, { maxRetries, backoffBaseMs });
    return res.status >= 200 && res.status < 300;
  };
  const ok = await execPost({ scroll_id: scrollId }) || await execPost({ scroll_id: [scrollId] }) || await tryDeletePath();
  if (!ok) {
    import_main.default.warn("closeScroll: failed to clear scroll_id");
  }
}
async function fetchElasticPitPage(opts) {
  const sess = getOrCreateSessionSyncState(opts);
  await ensurePitOpened(sess);
  if (sess.dialect === "scroll") {
    let entries2 = [];
    let total2 = null;
    if (!sess.pitId) {
      const first = await openScroll(
        sess.baseUrl,
        sess.index,
        sess.keepAlive,
        opts.size ?? 1e3,
        opts.sort,
        sess.headers,
        sess.allowInsecureTLS,
        sess.timeoutMs,
        sess.maxRetries,
        sess.backoffBaseMs,
        opts
      );
      sess.pitId = first.scrollId;
      entries2 = first.entries;
      total2 = first.total;
    } else {
      const next = await scrollNext(
        sess.baseUrl,
        sess.keepAlive,
        sess.pitId,
        sess.headers,
        sess.allowInsecureTLS,
        sess.timeoutMs,
        sess.maxRetries,
        sess.backoffBaseMs
      );
      sess.pitId = next.scrollId;
      entries2 = next.entries;
    }
    const hasMore2 = entries2.length > 0;
    sess.lastUsed = Date.now();
    if (!hasMore2) {
      try {
        if (sess.pitId)
          await closeScroll(
            sess.baseUrl,
            sess.pitId,
            sess.headers,
            sess.allowInsecureTLS,
            sess.timeoutMs,
            sess.maxRetries,
            sess.backoffBaseMs
          );
      } catch (e) {
        import_main.default.warn(
          "Scroll close after completion failed:",
          e instanceof Error ? e.message : String(e)
        );
      } finally {
        pitSessions.delete(sess.sessionId);
      }
    }
    return { entries: entries2, total: total2, hasMore: hasMore2, nextSearchAfter: null, pitSessionId: sess.sessionId };
  }
  const body = buildQueryBodyWithPit({ ...opts, keepAlive: sess.keepAlive }, sess.pitId);
  const res = await searchWithPit(sess, body);
  if (!(res.status >= 200 && res.status < 300))
    throw new Error(`Elasticsearch-Fehler ${res.status}: ${res.text.slice(0, 1200)}`);
  const { entries, total, hasMore, nextSearchAfter } = parseHitsResponse(
    res.json || null,
    opts.size ?? 1e3
  );
  sess.lastUsed = Date.now();
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
        sess.dialect
      );
    } catch (e) {
      import_main.default.warn("PIT close after completion failed:", e instanceof Error ? e.message : String(e));
    } finally {
      pitSessions.delete(sess.sessionId);
    }
  }
  return { entries, total, hasMore, nextSearchAfter, pitSessionId: sess.sessionId };
}
async function closeElasticPitSession(sessionId) {
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
            sess.backoffBaseMs
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
            sess.dialect
          );
        }
      } catch (e) {
        import_main.default.warn("PIT/Scroll close failed:", e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    pitSessions.delete(sessionId);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  closeElasticPitSession,
  fetchElasticPitPage,
  parseJsonFile,
  parsePaths,
  parseTextLines,
  parseZipFile,
  toEntry
});
