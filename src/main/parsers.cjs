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
  fetchElasticPage: () => fetchElasticPage,
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
    } catch (e) {
      try {
        const req = (0, import_module.createRequire)(import_path.default.join(process.cwd(), "package.json"));
        AdmZip = req("adm-zip");
      } catch (e2) {
        import_main.default.error("Failed to load adm-zip module:", e instanceof Error ? e.message : String(e));
        throw e2;
      }
    }
  }
  return AdmZip;
}
function toOptionalString(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    const s = String(v);
    return s;
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
    const candVals = [];
    try {
      const direct = o.stack_trace || o.stackTrace || o.stacktrace;
      if (direct != null) candVals.push(direct);
    } catch (e) {
      import_main.default.warn(
        "normalizeStack: reading direct stack fields failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      const err = o.error || o.err;
      if (err) {
        if (err.stack != null) candVals.push(err.stack);
        if (err.trace != null) candVals.push(err.trace);
        if (typeof err === "string") candVals.push(err);
      }
    } catch (e) {
      import_main.default.warn(
        "normalizeStack: reading error fields failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      const ex = o.exception || o.cause || o.throwable;
      if (ex) {
        if (ex.stack != null) candVals.push(ex.stack);
        if (ex.stackTrace != null) candVals.push(ex.stackTrace);
        if (typeof ex === "string") candVals.push(ex);
      }
    } catch (e) {
      import_main.default.warn(
        "normalizeStack: reading exception fields failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      if (o["exception.stacktrace"] != null)
        candVals.push(o["exception.stacktrace"]);
      if (o["error.stacktrace"] != null)
        candVals.push(o["error.stacktrace"]);
    } catch (e) {
      import_main.default.warn(
        "normalizeStack: reading flattened stacktrace fields failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
    for (const v of candVals) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const s = v.map((x) => x == null ? "" : String(x)).join("\n");
        if (s.trim()) return s;
      } else {
        const s = String(v ?? "");
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
      if (Array.isArray(arr)) {
        return arr.map(
          (o) => toEntry(o && typeof o === "object" ? o : {}, "", filename)
        );
      }
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
function toIsoIfDate(v) {
  if (v == null) return void 0;
  try {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
    const s = v.trim();
    if (!s) return void 0;
    if (/^\d+$/.test(s)) return new Date(parseInt(s, 10)).toISOString();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (m) {
      const [, Y, M, D, h, mi, sec = "0", ms = "0"] = m;
      const d2 = new Date(
        Number(Y),
        Number(M) - 1,
        Number(D),
        Number(h),
        Number(mi),
        Number(sec),
        Number(ms.padEnd(3, "0"))
      );
      return d2.toISOString();
    }
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
  const hasWildcard = (s) => /[*?]/.test(s);
  const addField = (field, value) => {
    const v = (value ?? "").trim();
    if (!v) return;
    if (hasWildcard(v)) {
      must.push({
        query_string: {
          query: v,
          default_field: field,
          analyze_wildcard: true,
          allow_leading_wildcard: true
        }
      });
    } else {
      must.push({
        match_phrase: { [field]: { query: v } }
      });
    }
  };
  addField("environment", opts.environment);
  addField("application_name", opts.application_name);
  addField("logger", opts.logger);
  addField("level", opts.level);
  addField("message", opts.message);
  const range = {};
  if (opts.duration && String(opts.duration).trim()) {
    range.gte = `now-${opts.duration}`;
    range.lte = "now";
  } else {
    const num = (x) => typeof x === "number" ? x : /^\d+$/.test(String(x ?? "")) ? Number(x) : null;
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
  if (Object.keys(range).length > 0) {
    must.push({ range: { "@timestamp": range } });
  }
  const body = {
    version: true,
    size: opts.size ?? 1e3,
    sort: [
      {
        "@timestamp": { order: opts.sort ?? "asc", unmapped_type: "boolean" }
      },
      { _id: { order: opts.sort ?? "asc" } }
    ],
    _source: { excludes: [] },
    stored_fields: ["*"],
    script_fields: {},
    docvalue_fields: [{ field: "@timestamp", format: "date_time" }],
    query: {
      bool: {
        must,
        filter: filter.length ? filter : [{ match_all: {} }],
        should: [],
        must_not: []
      }
    },
    highlight: {
      pre_tags: ["@kibana-highlighted-field@"],
      post_tags: ["@/kibana-highlighted-field@"],
      fields: { "*": {} },
      fragment_size: 2147483647
    }
  };
  if (Array.isArray(opts.searchAfter) && opts.searchAfter.length > 0) {
    body.search_after = opts.searchAfter;
  }
  return body;
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
        import_main.default.info("[Elastic] POST", `${u.protocol}//${u.host}${opts.path ?? ""}`, safeHeaders);
      } catch (e) {
        import_main.default.warn("Elastic POST logging failed:", e instanceof Error ? e.message : String(e));
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
            import_main.default.info(`[Elastic] POST ${status} response received`);
            try {
              const json = text ? JSON.parse(text) : {};
              resolve(json);
            } catch (e) {
              import_main.default.warn(
                "Elastic POST response parse failed, returning empty object:",
                e instanceof Error ? e.message : String(e)
              );
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
async function fetchElasticPage(opts) {
  const base = (opts.url || "").replace(/\/$/, "");
  if (!base) throw new Error("Elasticsearch URL (opts.url) ist erforderlich");
  const index = encodeURIComponent(opts.index ?? "_all");
  const url = `${base}/${index}/_search?ignore_throttled=false&ignore_unavailable=true`;
  const body = buildElasticSearchBody(opts);
  const headers = buildElasticHeaders(opts.auth);
  const data = await postJson(url, body, headers, !!opts.allowInsecureTLS);
  const dataObj = data && typeof data === "object" ? data : {};
  const hitsContainer = dataObj.hits;
  const totalVal = (() => {
    const t = hitsContainer && hitsContainer.total;
    if (!t) return 0;
    if (typeof t === "number") return t;
    if (typeof t === "object" && t != null && typeof t.value === "number")
      return Number(t.value) || 0;
    return 0;
  })();
  const hitsArray = hitsContainer && Array.isArray(hitsContainer.hits) ? hitsContainer.hits : [];
  const out = [];
  for (const h of hitsArray) {
    const hObj = h && typeof h === "object" ? h : {};
    const src = hObj._source ?? hObj.fields ?? {};
    const srcObj = src && typeof src === "object" ? src : {};
    const index2 = hObj._index;
    const id = hObj._id;
    const indexStr = typeof index2 === "string" ? index2 : opts.index ?? "";
    const idStr = typeof id === "string" ? id : "";
    const e = toEntry(srcObj, "", `elastic://${indexStr}/${idStr}`);
    out.push(e);
  }
  const lastHit = hitsArray.length > 0 ? hitsArray[hitsArray.length - 1] : null;
  const sortVals = lastHit && Array.isArray(lastHit.sort) ? lastHit.sort : null;
  const size = opts.size ?? 1e3;
  const hasMore = hitsArray.length >= size;
  return {
    entries: out,
    total: totalVal,
    hasMore,
    nextSearchAfter: hasMore && sortVals && sortVals.length ? sortVals : null
  };
}
async function fetchElasticLogs(opts) {
  const page = await fetchElasticPage(opts);
  return page.entries;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetchElasticLogs,
  fetchElasticPage,
  parseJsonFile,
  parsePaths,
  parseTextLines,
  parseZipFile,
  toEntry
});
