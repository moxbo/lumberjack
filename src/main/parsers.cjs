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
  fetchElasticLogs: () => fetchElasticLogs,
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
let AdmZip = null;
function getAdmZip() {
  if (!AdmZip) {
    try {
      AdmZip = require("adm-zip");
    } catch {
      const req = (0, import_module.createRequire)(import_path.default.join(process.cwd(), "package.json"));
      AdmZip = req("adm-zip");
    }
  }
  return AdmZip;
}
function toEntry(obj = {}, fallbackMessage = "", source = "") {
  function normalizeStack(o) {
    if (!o || typeof o !== "object") return null;
    const candVals = [];
    try {
      const direct = o.stack_trace || o.stackTrace || o.stacktrace;
      if (direct != null) candVals.push(direct);
    } catch {
    }
    try {
      const err = o.error || o.err;
      if (err) {
        if (err.stack != null) candVals.push(err.stack);
        if (err.trace != null) candVals.push(err.trace);
        if (typeof err === "string") candVals.push(err);
      }
    } catch {
    }
    try {
      const ex = o.exception || o.cause || o.throwable;
      if (ex) {
        if (ex.stack != null) candVals.push(ex.stack);
        if (ex.stackTrace != null) candVals.push(ex.stackTrace);
        if (typeof ex === "string") candVals.push(ex);
      }
    } catch {
    }
    try {
      if (o["exception.stacktrace"] != null)
        candVals.push(o["exception.stacktrace"]);
      if (o["error.stacktrace"] != null)
        candVals.push(o["error.stacktrace"]);
    } catch {
    }
    for (const v of candVals) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const s = v.map((x) => x == null ? "" : String(x)).join("\n");
        if (s.trim()) return s;
      } else {
        const s = String(v);
        if (s.trim()) return s;
      }
    }
    return null;
  }
  const stackTrace = normalizeStack(obj);
  return {
    timestamp: obj.timestamp || obj["@timestamp"] || obj.time || null,
    level: obj.level || obj.severity || obj.loglevel || null,
    logger: obj.logger || obj.logger_name || obj.category || null,
    thread: obj.thread || obj.thread_name || null,
    message: obj.message || obj.msg || obj.log || fallbackMessage || "",
    traceId: obj.traceId || obj.trace_id || obj.trace || obj["trace.id"] || obj.TraceID || null,
    stackTrace: stackTrace || null,
    raw: obj,
    source
  };
}
function tryParseJson(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
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
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
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
      if (Array.isArray(arr)) return arr.map((o) => toEntry(o, "", filename));
    } catch (_) {
    }
  }
  return parseTextLines(filename, text);
}
function parseZipFile(zipPath) {
  const ZipClass = getAdmZip();
  const zip = new ZipClass(zipPath, null);
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
function toIsoIfDate(v) {
  if (v == null) return void 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") return v;
  return void 0;
}
function buildElasticSearchBody(opts) {
  const must = [];
  const filter = [];
  if (opts.message && opts.message.trim()) {
    must.push({ match_phrase: { message: opts.message } });
  }
  if (opts.logger && opts.logger.trim()) {
    must.push({ match_phrase: { logger: opts.logger } });
  }
  if (opts.level && opts.level.trim()) {
    must.push({ match_phrase: { level: opts.level } });
  }
  if (opts.application_name && opts.application_name.trim()) {
    must.push({ match_phrase: { application_name: opts.application_name } });
  }
  if (opts.environment && opts.environment.trim()) {
    must.push({ match_phrase: { environment: opts.environment } });
  }
  const range = {};
  if (opts.duration && opts.duration.trim()) {
    range.gte = `now-${opts.duration}`;
    range.lte = "now";
  } else {
    const from = toIsoIfDate(opts.from);
    const to = toIsoIfDate(opts.to);
    if (from) range.gte = from;
    if (to) range.lte = to;
  }
  if (Object.keys(range).length > 0) {
    filter.push({ range: { "@timestamp": range } });
  }
  return {
    size: opts.size ?? 1e3,
    sort: [{ "@timestamp": { order: opts.sort ?? "desc" } }],
    query: {
      bool: {
        must,
        filter
      }
    }
  };
}
function buildElasticHeaders(auth) {
  const headers = { "content-type": "application/json" };
  if (!auth) return headers;
  switch (auth.type) {
    case "basic": {
      const user = auth.username ?? "";
      const pass = auth.password ?? "";
      const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
      headers["authorization"] = `Basic ${token}`;
      break;
    }
    case "apiKey": {
      if (auth.token) headers["authorization"] = `ApiKey ${auth.token}`;
      break;
    }
    case "bearer": {
      if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
      break;
    }
  }
  return headers;
}
function postJson(urlStr, body, headers, allowInsecureTLS) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const mod = isHttps ? import_https.default : import_http.default;
      const opts = {
        method: "POST",
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        headers
      };
      try {
        const { authorization: _auth, ...safeHeaders } = headers || {};
        import_main.default.info("[Elastic] POST", `${u.protocol}//${u.host}${opts.path}`, safeHeaders);
      } catch {
      }
      if (isHttps && allowInsecureTLS) {
        opts.agent = new import_https.default.Agent({ rejectUnauthorized: false });
      }
      const req = mod.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 300) {
            try {
              const json = text ? JSON.parse(text) : {};
              resolve(json);
            } catch (e) {
              resolve({});
            }
          } else {
            reject(new Error(`Elasticsearch-Fehler ${status}: ${text}`));
          }
        });
      });
      req.on("error", (err) => reject(err));
      const payload = body ? JSON.stringify(body) : "";
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
async function fetchElasticLogs(opts) {
  const base = (opts.url || "").replace(/\/$/, "");
  if (!base) throw new Error("Elasticsearch URL (opts.url) ist erforderlich");
  const index = encodeURIComponent(opts.index ?? "_all");
  const url = `${base}/${index}/_search`;
  const body = buildElasticSearchBody(opts);
  const headers = buildElasticHeaders(opts.auth);
  const data = await postJson(url, body, headers, !!opts.allowInsecureTLS);
  const hits = data?.hits?.hits ?? [];
  const out = [];
  for (const h of hits) {
    const src = h?._source ?? h?.fields ?? {};
    const e = toEntry(src, "", `elastic://${h?._index ?? opts.index ?? ""}/${h?._id ?? ""}`);
    out.push(e);
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetchElasticLogs,
  parseJsonFile,
  parsePaths,
  parseTextLines,
  parseZipFile,
  toEntry
});
