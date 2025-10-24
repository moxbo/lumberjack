// Lightweight log parser utilities for main process and tests
// Supports: .log (text or JSONL), .json (array or JSONL), .zip (containing .log/.json)

import fs from 'fs';
import path from 'path';
// Lazy-load AdmZip only when needed to speed up startup
let AdmZip: any = null;
function getAdmZip() {
  if (!AdmZip) {
    AdmZip = require('adm-zip');
  }
  return AdmZip;
}

// Normalize one entry into a standard object
function toEntry(obj = {}, fallbackMessage = '', source = '') {
  // Normalisiere Stacktrace aus gängigen Feldern
  function normalizeStack(o) {
    if (!o || typeof o !== 'object') return null;
    const candVals = [];
    try {
      const direct = o.stack_trace || o.stackTrace || o.stacktrace;
      if (direct != null) candVals.push(direct);
    } catch {}
    try {
      const err = o.error || o.err;
      if (err) {
        if (err.stack != null) candVals.push(err.stack);
        if (err.trace != null) candVals.push(err.trace);
        if (typeof err === 'string') candVals.push(err);
      }
    } catch {}
    try {
      const ex = o.exception || o.cause || o.throwable;
      if (ex) {
        if (ex.stack != null) candVals.push(ex.stack);
        if (ex.stackTrace != null) candVals.push(ex.stackTrace);
        if (typeof ex === 'string') candVals.push(ex);
      }
    } catch {}
    try {
      if (o['exception.stacktrace'] != null) candVals.push(o['exception.stacktrace']);
      if (o['error.stacktrace'] != null) candVals.push(o['error.stacktrace']);
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
      // try to extract {...} json inside line
      const match = line.match(/{[\s\S]*}$/);
      if (match) obj = tryParseJson(match[0]);
    }
    if (obj) {
      entries.push(toEntry(obj, '', filename));
    } else {
      // fallback: plain text line
      // try to parse timestamp like ISO 8601 at the beginning
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
  // supports JSON array or NDJSON
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map((o) => toEntry(o, '', filename));
    } catch (_) {}
  }
  // treat as NDJSON
  return parseTextLines(filename, text);
}

function parseZipFile(zipPath) {
  const ZipClass = getAdmZip();
  const zip = new ZipClass(zipPath, null);
  const entries = [];
  zip.getEntries().forEach((zEntry) => {
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

function parsePath(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) return [];
  const ext = path.extname(p).toLowerCase();
  const text = ext === '.zip' ? null : fs.readFileSync(p, 'utf8');
  if (ext === '.zip') return parseZipFile(p);
  if (ext === '.json') return parseJsonFile(p, text);
  if (ext === '.jsonl' || ext === '.txt') return parseTextLines(p, text);
  if (ext === '.log' || !ext) return parseTextLines(p, text);
  return [];
}

function parsePaths(paths) {
  const all = [];
  for (const p of paths) {
    try {
      all.push(...parsePath(p));
    } catch (err) {
      // include error as a special entry
      all.push(toEntry({ level: 'ERROR', message: `Failed to parse ${p}: ${err.message}` }, '', p));
    }
  }
    return all;
}

export {
  parsePaths,
  parseTextLines,
  parseJsonFile,
  parseZipFile,
  toEntry,
};
