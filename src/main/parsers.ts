// Lightweight log parser utilities for main process and tests
// Supports: .log (text or JSONL), .json (array or JSONL), .zip (containing .log/.json)

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import https from 'https';
import http from 'http';
import log from 'electron-log/main';

// Types
type AnyMap = Record<string, any>;
interface Entry {
  timestamp: string | null;
  level: string | null;
  logger: string | null;
  thread: string | null;
  message: string;
  traceId: string | null;
  stackTrace: string | null;
  raw: any;
  source: string;
  // optional UI hints used elsewhere
  _mark?: string;
  mdc?: Record<string, string>;
  service?: string;
}

// Lazy-load AdmZip only when needed to speed up startup
let AdmZip: any = null;
function getAdmZip() {
  if (!AdmZip) {
    try {
      // Prefer direct require in CJS build
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      AdmZip = require('adm-zip');
    } catch {
      // Fallback: use createRequire from module, anchored at cwd
      const req = createRequire(path.join(process.cwd(), 'package.json'));
      AdmZip = req('adm-zip');
    }
  }
  return AdmZip;
}

// Normalize one entry into a standard object
function toEntry(obj: AnyMap = {}, fallbackMessage = '', source = ''): Entry {
  // Normalisiere Stacktrace aus gängigen Feldern
  function normalizeStack(o: any): string | null {
    if (!o || typeof o !== 'object') return null;
    const candVals: any[] = [];
    try {
      const direct =
        (o as AnyMap).stack_trace || (o as AnyMap).stackTrace || (o as AnyMap).stacktrace;
      if (direct != null) candVals.push(direct);
    } catch {}
    try {
      const err = (o as AnyMap).error || (o as AnyMap).err;
      if (err) {
        if ((err as AnyMap).stack != null) candVals.push((err as AnyMap).stack);
        if ((err as AnyMap).trace != null) candVals.push((err as AnyMap).trace);
        if (typeof err === 'string') candVals.push(err);
      }
    } catch {}
    try {
      const ex = (o as AnyMap).exception || (o as AnyMap).cause || (o as AnyMap).throwable;
      if (ex) {
        if ((ex as AnyMap).stack != null) candVals.push((ex as AnyMap).stack);
        if ((ex as AnyMap).stackTrace != null) candVals.push((ex as AnyMap).stackTrace);
        if (typeof ex === 'string') candVals.push(ex);
      }
    } catch {}
    try {
      if ((o as AnyMap)['exception.stacktrace'] != null)
        candVals.push((o as AnyMap)['exception.stacktrace']);
      if ((o as AnyMap)['error.stacktrace'] != null)
        candVals.push((o as AnyMap)['error.stacktrace']);
    } catch {}

    for (const v of candVals) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const s = v.map((x) => (x == null ? '' : String(x))).join('\n');
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
    timestamp:
      (obj as AnyMap).timestamp || (obj as AnyMap)['@timestamp'] || (obj as AnyMap).time || null,
    level: (obj as AnyMap).level || (obj as AnyMap).severity || (obj as AnyMap).loglevel || null,
    logger:
      (obj as AnyMap).logger || (obj as AnyMap).logger_name || (obj as AnyMap).category || null,
    thread: (obj as AnyMap).thread || (obj as AnyMap).thread_name || null,
    message:
      (obj as AnyMap).message ||
      (obj as AnyMap).msg ||
      (obj as AnyMap).log ||
      fallbackMessage ||
      '',
    traceId:
      (obj as AnyMap).traceId ||
      (obj as AnyMap).trace_id ||
      (obj as AnyMap).trace ||
      (obj as AnyMap)['trace.id'] ||
      (obj as AnyMap).TraceID ||
      null,
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
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map((o: AnyMap) => toEntry(o, '', filename));
    } catch (_) {}
  }
  // treat as NDJSON
  return parseTextLines(filename, text);
}

function parseZipFile(zipPath: string): Entry[] {
  const ZipClass = getAdmZip();
  const zip = new ZipClass(zipPath, null);
  const entries: Entry[] = [];
  zip.getEntries().forEach((zEntry: any) => {
    const name = zEntry.entryName as string;
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
}

function toIsoIfDate(v: any): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'string') return v;
  return undefined;
}

function buildElasticSearchBody(opts: ElasticsearchOptions) {
  const must: AnyMap[] = [];
  const filter: AnyMap[] = [];

  // message full-text
  if (opts.message && opts.message.trim()) {
    must.push({ match_phrase: { message: opts.message } });
  }
  // exact-ish matches (use match_phrase for flexibility across mappings)
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

  // time range on @timestamp
  const range: AnyMap = {};
  if (opts.duration && opts.duration.trim()) {
    range.gte = `now-${opts.duration}`;
    range.lte = 'now';
  } else {
    const from = toIsoIfDate(opts.from);
    const to = toIsoIfDate(opts.to);
    if (from) range.gte = from;
    if (to) range.lte = to;
  }
  if (Object.keys(range).length > 0) {
    filter.push({ range: { '@timestamp': range } });
  }

  return {
    size: opts.size ?? 1000,
    sort: [{ '@timestamp': { order: opts.sort ?? 'desc' } }],
    query: {
      bool: {
        must,
        filter,
      },
    },
  };
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
  body: any,
  headers: Record<string, string>,
  allowInsecureTLS?: boolean
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const opts: any = {
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
        log.info('[Elastic] POST', `${u.protocol}//${u.host}${opts.path}`, safeHeaders);
      } catch {}
      if (isHttps && allowInsecureTLS) {
        opts.agent = new https.Agent({ rejectUnauthorized: false });
      }
      const req = mod.request(opts, (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
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
      req.on('error', (err: any) => reject(err));
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
  const url = `${base}/${index}/_search`;

  const body = buildElasticSearchBody(opts);
  const headers = buildElasticHeaders(opts.auth);

  const data = await postJson(url, body, headers, !!opts.allowInsecureTLS);
  const hits: any[] = data?.hits?.hits ?? [];

  const out: Entry[] = [];
  for (const h of hits) {
    const src = h?._source ?? h?.fields ?? {};
    const e = toEntry(src, '', `elastic://${h?._index ?? opts.index ?? ''}/${h?._id ?? ''}`);
    out.push(e);
  }
  return out;
}

export { parsePaths, parseTextLines, parseJsonFile, parseZipFile, toEntry };
