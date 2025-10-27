// Lightweight log parser utilities for main process and tests
// Supports: .log (text or JSONL), .json (array or JSONL), .zip (containing .log/.json)

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import https from 'https';
import http from 'http';
import log from 'electron-log/main';

// Types
type AnyMap = Record<string, unknown>;
interface Entry {
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

// AdmZip types
type AdmZipConstructor = new (filePath?: string) => AdmZipInstance;
interface AdmZipInstance {
  getEntries(): AdmZipEntry[];
  extractAllTo(targetPath: string, overwrite?: boolean): void;
  readAsText(fileName: string): string;
}
interface AdmZipEntry {
  entryName: string;
  isDirectory: boolean;
  getData(): Buffer;
}

// Lazy-load AdmZip only when needed to speed up startup
let AdmZip: AdmZipConstructor | null = null;
function getAdmZip(): AdmZipConstructor {
  if (!AdmZip) {
    try {
      // Prefer direct require in CJS build

      AdmZip = require('adm-zip') as AdmZipConstructor;
    } catch (e) {
      // Fallback: use createRequire from module, anchored at cwd
      try {
        const req = createRequire(path.join(process.cwd(), 'package.json'));
        AdmZip = req('adm-zip') as AdmZipConstructor;
      } catch (e2) {
        log.error('Failed to load adm-zip module:', e instanceof Error ? e.message : String(e));
        throw e2;
      }
    }
  }
  return AdmZip;
}

// Normalize one entry into a standard object
function toEntry(obj: AnyMap = {}, fallbackMessage = '', source = ''): Entry {
  // Normalisiere Stacktrace aus gängigen Feldern
  function normalizeStack(o: unknown): string | null {
    if (!o || typeof o !== 'object') return null;
    const candVals: unknown[] = [];
    try {
      const direct =
        (o as AnyMap).stack_trace || (o as AnyMap).stackTrace || (o as AnyMap).stacktrace;
      if (direct != null) candVals.push(direct);
    } catch (e) {
      log.warn(
        'normalizeStack: reading direct stack fields failed:',
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      const err = (o as AnyMap).error || (o as AnyMap).err;
      if (err) {
        if ((err as AnyMap).stack != null) candVals.push((err as AnyMap).stack);
        if ((err as AnyMap).trace != null) candVals.push((err as AnyMap).trace);
        if (typeof err === 'string') candVals.push(err);
      }
    } catch (e) {
      log.warn(
        'normalizeStack: reading error fields failed:',
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      const ex = (o as AnyMap).exception || (o as AnyMap).cause || (o as AnyMap).throwable;
      if (ex) {
        if ((ex as AnyMap).stack != null) candVals.push((ex as AnyMap).stack);
        if ((ex as AnyMap).stackTrace != null) candVals.push((ex as AnyMap).stackTrace);
        if (typeof ex === 'string') candVals.push(ex);
      }
    } catch (e) {
      log.warn(
        'normalizeStack: reading exception fields failed:',
        e instanceof Error ? e.message : String(e)
      );
    }
    try {
      if ((o as AnyMap)['exception.stacktrace'] != null)
        candVals.push((o as AnyMap)['exception.stacktrace']);
      if ((o as AnyMap)['error.stacktrace'] != null)
        candVals.push((o as AnyMap)['error.stacktrace']);
    } catch (e) {
      log.warn(
        'normalizeStack: reading flattened stacktrace fields failed:',
        e instanceof Error ? e.message : String(e)
      );
    }

    for (const v of candVals) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const s = v.map((x) => (x == null ? '' : String(x))).join('\n');
        if (s.trim()) return s;
      } else {
        const s = String(v ?? '');
        if (s.trim()) return s;
      }
    }
    return null;
  }

  const stackTrace = normalizeStack(obj);

  return {
    timestamp: obj.timestamp || obj['@timestamp'] || obj.time || null,
    level: obj.level || obj.severity || obj.loglevel || null,
    logger: obj.logger || obj.logger_name || obj.category || null,
    thread: obj.thread || obj.thread_name || null,
    message: obj.message || obj.msg || obj.log || fallbackMessage || '',
    traceId: obj.traceId || obj.trace_id || obj.trace || obj['trace.id'] || obj.TraceID || null,
    stackTrace: stackTrace || null,
    raw: obj,
    source,
  };
}

function tryParseJson(line: string): AnyMap | null {
  try {
    return JSON.parse(line);
  } catch (_) {
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
    if (obj) {
      entries.push(toEntry(obj, '', filename));
    } else {
      // fallback: plain text line
      // try to parse timestamp like ISO 8601 at the beginning
      let ts: string | null = null;
      const isoMatch = line.match(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
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
  if (trimmed.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((o: unknown) =>
          toEntry((o && typeof o === 'object' ? o : {}) as AnyMap, '', filename)
        );
      }
    } catch (e) {
      log.warn(
        'parseJsonFile: JSON array parse failed:',
        e instanceof Error ? e.message : String(e)
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
      (ext === '.log' || ext === '.json' || ext === '.jsonl' || ext === '.txt')
    ) {
      const text = zEntry.getData().toString('utf8');
      const parsed = ext === '.json' ? parseJsonFile(name, text) : parseTextLines(name, text);
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
  const text = ext === '.zip' ? null : fs.readFileSync(p, 'utf8');
  if (ext === '.zip') return parseZipFile(p);
  if (ext === '.json') return parseJsonFile(p, text as string);
  if (ext === '.jsonl' || ext === '.txt') return parseTextLines(p, text as string);
  if (ext === '.log' || !ext) return parseTextLines(p, text as string);
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
      all.push(toEntry({ level: 'ERROR', message: `Failed to parse ${p}: ${msg}` }, '', p));
    }
  }
  return all;
}

export interface ElasticsearchAuth {
  type: 'basic' | 'apiKey' | 'bearer';
  username?: string; // for basic
  password?: string; // for basic
  token?: string; // for apiKey or bearer
}

export interface ElasticsearchOptions {
  url: string; // e.g., https://my-es:9200
  index?: string; // e.g., logs-*
  from?: string | Date; // ISO string or Date
  to?: string | Date; // ISO string or Date
  duration?: string; // e.g., 15m, 4h, 7d (uses now-duration .. now)
  logger?: string;
  level?: string;
  message?: string;
  application_name?: string;
  environment?: string;
  size?: number; // default 1000
  sort?: 'asc' | 'desc'; // default desc
  auth?: ElasticsearchAuth;
  allowInsecureTLS?: boolean; // default false
  // Pagination: ES search_after token from previous page
  searchAfter?: Array<string | number>;
}

function toIsoIfDate(v: string | number | Date | undefined): string | undefined {
  if (v == null) return undefined;
  try {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    const s = v.trim();
    if (!s) return undefined;
    if (/^\d+$/.test(s)) return new Date(parseInt(s, 10)).toISOString();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (m) {
      const [, Y, M, D, h, mi, sec = '0', ms = '0'] = m;
      // Construct as local time, then convert to UTC ISO
      const d = new Date(
        Number(Y),
        Number(M) - 1,
        Number(D),
        Number(h),
        Number(mi),
        Number(sec),
        Number(ms.padEnd(3, '0'))
      );
      return d.toISOString();
    }
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

  const hasWildcard = (s: string): boolean => /[*?]/.test(s);

  // helper: add field condition, match_phrase by default; query_string if wildcards present
  const addField = (field: string, value?: string): void => {
    const v = (value ?? '').trim();
    if (!v) return;
    if (hasWildcard(v)) {
      must.push({
        query_string: {
          query: v,
          default_field: field,
          analyze_wildcard: true,
          allow_leading_wildcard: true,
        },
      });
    } else {
      must.push({
        match_phrase: { [field]: { query: v } },
      });
    }
  };

  // fields
  addField('environment', opts.environment);
  addField('application_name', opts.application_name);
  addField('logger', opts.logger);
  addField('level', opts.level);
  addField('message', opts.message);

  // time range on @timestamp
  const range: AnyMap = {};
  if (opts.duration && String(opts.duration).trim()) {
    range.gte = `now-${opts.duration}`;
    range.lte = 'now';
  } else {
    // Detect epoch millis if numeric
    const num = (x: unknown): number | null =>
      typeof x === 'number' ? x : /^\d+$/.test(String(x ?? '')) ? Number(x) : null;
    const fromNum = num(opts.from);
    const toNum = num(opts.to);
    if (fromNum != null || toNum != null) {
      if (fromNum != null) range.gte = fromNum;
      if (toNum != null) range.lte = toNum;
      range.format = 'epoch_millis';
    } else {
      const from = toIsoIfDate(opts.from);
      const to = toIsoIfDate(opts.to);
      if (from) range.gte = from;
      if (to) range.lte = to;
    }
  }
  if (Object.keys(range).length > 0) {
    must.push({ range: { '@timestamp': range } });
  }

  // Build body aligned to Kibana-style JSON (only essential parts)
  const body: AnyMap = {
    version: true,
    size: opts.size ?? 1000,
    sort: [
      {
        '@timestamp': { order: opts.sort ?? 'asc', unmapped_type: 'boolean' },
      },
      { _id: { order: opts.sort ?? 'asc' } },
    ],
    _source: { excludes: [] },
    stored_fields: ['*'],
    script_fields: {},
    docvalue_fields: [{ field: '@timestamp', format: 'date_time' }],
    query: {
      bool: {
        must,
        filter: filter.length ? filter : [{ match_all: {} }],
        should: [],
        must_not: [],
      },
    },
    highlight: {
      pre_tags: ['@kibana-highlighted-field@'],
      post_tags: ['@/kibana-highlighted-field@'],
      fields: { '*': {} },
      fragment_size: 2147483647,
    },
  };
  // Add search_after if provided for pagination
  if (Array.isArray(opts.searchAfter) && opts.searchAfter.length > 0) {
    (body as any).search_after = opts.searchAfter;
  }
  return body;
}

function buildElasticHeaders(auth?: ElasticsearchAuth): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!auth) return headers;
  switch (auth.type) {
    case 'basic': {
      const user = auth.username ?? '';
      const pass = auth.password ?? '';
      const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
      headers['authorization'] = `Basic ${token}`;
      break;
    }
    case 'apiKey': {
      if (auth.token) headers['authorization'] = `ApiKey ${auth.token}`;
      break;
    }
    case 'bearer': {
      if (auth.token) headers['authorization'] = `Bearer ${auth.token}`;
      break;
    }
  }
  return headers;
}

function postJson(
  urlStr: string,
  body: unknown,
  headers: Record<string, string>,
  allowInsecureTLS?: boolean
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const opts: http.RequestOptions = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        headers,
      };
      // Lightweight debug: log target URL and size header (no credentials)
      try {
        // Avoid logging Authorization header
        const { authorization: _auth, ...safeHeaders } = headers || {};
        log.info('[Elastic] POST', `${u.protocol}//${u.host}${opts.path ?? ''}`, safeHeaders);
      } catch (e) {
        log.warn('Elastic POST logging failed:', e instanceof Error ? e.message : String(e));
      }
      if (isHttps && allowInsecureTLS) {
        opts.agent = new https.Agent({ rejectUnauthorized: false });
      }
      const req = mod.request(opts, (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 300) {
            log.info(`[Elastic] POST ${status} response received`);
            try {
              const json: unknown = text ? JSON.parse(text) : {};
              resolve(json);
            } catch (e) {
              log.warn(
                'Elastic POST response parse failed, returning empty object:',
                e instanceof Error ? e.message : String(e)
              );
              resolve({});
            }
          } else {
            reject(new Error(`Elasticsearch-Fehler ${status}: ${text}`));
          }
        });
      });
      req.on('error', (err: Error) => reject(err));
      const payload = body ? JSON.stringify(body) : '';
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fetch log entries from Elasticsearch via REST _search API.
 * Returns normalized Entry[] compatible with local file parsers.
 */
export async function fetchElasticLogs(opts: ElasticsearchOptions): Promise<Entry[]> {
  const base = (opts.url || '').replace(/\/$/, '');
  if (!base) throw new Error('Elasticsearch URL (opts.url) ist erforderlich');
  const index = encodeURIComponent(opts.index ?? '_all');
  // Adjust URL to include requested query parameters
  const url = `${base}/${index}/_search?ignore_throttled=false&ignore_unavailable=true`;

  const body = buildElasticSearchBody(opts);
  const headers = buildElasticHeaders(opts.auth);

  const data = await postJson(url, body, headers, !!opts.allowInsecureTLS);
  const dataObj = data && typeof data === 'object' ? (data as AnyMap) : {};
  const hitsContainer = dataObj.hits;
  const hitsArray =
    hitsContainer && typeof hitsContainer === 'object' ? (hitsContainer as AnyMap).hits : undefined;
  const hits: unknown[] = Array.isArray(hitsArray) ? hitsArray : [];

  const out: Entry[] = [];
  for (const h of hits) {
    const hObj = h && typeof h === 'object' ? (h as AnyMap) : {};
    const src = hObj._source ?? hObj.fields ?? {};
    const srcObj = src && typeof src === 'object' ? (src as AnyMap) : {};
    const index = hObj._index;
    const id = hObj._id;
    const indexStr = typeof index === 'string' ? index : (opts.index ?? '');
    const idStr = typeof id === 'string' ? id : '';
    const e = toEntry(srcObj, '', `elastic://${indexStr}/${idStr}`);
    out.push(e);
  }
  return out;
}

/**
 * Fetch a single page from Elasticsearch with pagination info
 */
export async function fetchElasticPage(opts: ElasticsearchOptions): Promise<{
  entries: Entry[];
  total: number;
  hasMore: boolean;
  nextSearchAfter: Array<string | number> | null;
}> {
  const base = (opts.url || '').replace(/\/$/, '');
  if (!base) throw new Error('Elasticsearch URL (opts.url) ist erforderlich');
  const index = encodeURIComponent(opts.index ?? '_all');
  const url = `${base}/${index}/_search?ignore_throttled=false&ignore_unavailable=true`;

  const body = buildElasticSearchBody(opts);
  const headers = buildElasticHeaders(opts.auth);

  const data = await postJson(url, body, headers, !!opts.allowInsecureTLS);
  const dataObj = data && typeof data === 'object' ? (data as AnyMap) : {};
  const hitsContainer = dataObj.hits as AnyMap | undefined;
  const totalVal = (() => {
    const t = hitsContainer && (hitsContainer as AnyMap).total;
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t === 'object' && t != null && typeof (t as AnyMap).value === 'number')
      return Number((t as AnyMap).value) || 0;
    return 0;
  })();
  const hitsArray =
    hitsContainer && Array.isArray((hitsContainer as AnyMap).hits)
      ? ((hitsContainer as AnyMap).hits as unknown[])
      : [];

  const out: Entry[] = [];
  for (const h of hitsArray) {
    const hObj = h && typeof h === 'object' ? (h as AnyMap) : {};
    const src = (hObj as AnyMap)._source ?? (hObj as AnyMap).fields ?? {};
    const srcObj = src && typeof src === 'object' ? (src as AnyMap) : {};
    const index = (hObj as AnyMap)._index;
    const id = (hObj as AnyMap)._id;
    const indexStr = typeof index === 'string' ? index : (opts.index ?? '');
    const idStr = typeof id === 'string' ? id : '';
    const e = toEntry(srcObj, '', `elastic://${indexStr}/${idStr}`);
    out.push(e);
  }

  // Determine next search_after from last hit sort values
  const lastHit = hitsArray.length > 0 ? (hitsArray[hitsArray.length - 1] as AnyMap) : null;
  const sortVals =
    lastHit && Array.isArray((lastHit as AnyMap).sort)
      ? ((lastHit as AnyMap).sort as Array<string | number>)
      : null;
  const size = opts.size ?? 1000;
  const hasMore = hitsArray.length >= size;

  return {
    entries: out,
    total: totalVal,
    hasMore,
    nextSearchAfter: hasMore && sortVals && sortVals.length ? sortVals : null,
  };
}

/**
 * Back-compat: fetch first page only (no pagination info)
 */
export async function fetchElasticLogs(opts: ElasticsearchOptions): Promise<Entry[]> {
  const page = await fetchElasticPage(opts);
  return page.entries;
}

export { parsePaths, parseTextLines, parseJsonFile, parseZipFile, toEntry };
