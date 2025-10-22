// Lightweight log parser utilities for main process and tests
// Supports: .log (text or JSONL), .json (array or JSONL), .zip (containing .log/.json)

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Normalize one entry into a standard object
function toEntry(obj = {}, fallbackMessage = '', source = '') {
  return {
    timestamp: obj.timestamp || obj['@timestamp'] || obj.time || null,
    level: obj.level || obj.severity || obj.loglevel || null,
    logger: obj.logger || obj.logger_name || obj.category || null,
    thread: obj.thread || obj.thread_name || null,
    message: obj.message || obj.msg || obj.log || fallbackMessage || '',
    traceId: obj.traceId || obj.trace_id || obj.trace || obj['trace.id'] || obj.TraceID || null,
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
      const match = line.match(/\{[\s\S]*\}$/);
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
  const zip = new AdmZip(zipPath);
  const entries = [];
  zip.getEntries().forEach((zEntry) => {
    const name = zEntry.entryName;
    const ext = path.extname(name).toLowerCase();
    if (!zEntry.isDirectory && (ext === '.log' || ext === '.json')) {
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

module.exports = {
  parsePaths,
  parseTextLines,
  parseJsonFile,
  parseZipFile,
  toEntry,
};
