/**
 * Web Worker for heavy parsing operations
 * Offloads CPU-intensive parsing to a background thread
 * to keep the main thread responsive
 */

// Worker-safe implementation of parsing logic
self.onmessage = async function (e) {
  const { type, data, id } = e.data;

  try {
    switch (type) {
      case 'parseLines': {
        const { lines, filename } = data;
        const entries = parseTextLinesWorker(lines, filename);
        self.postMessage({ type: 'parseLines', id, result: entries });
        break;
      }

      case 'parseJSON': {
        const { text, filename } = data;
        const entries = parseJsonWorker(text, filename);
        self.postMessage({ type: 'parseJSON', id, result: entries });
        break;
      }

      case 'parseZipEntries': {
        const { entries: zipEntries, zipName } = data;
        const parsed = [];
        for (const entry of zipEntries) {
          const { name, text } = entry;
          const ext = name.toLowerCase().split('.').pop();
          let entryData = [];
          if (ext === 'json') {
            entryData = parseJsonWorker(text, name);
          } else {
            entryData = parseTextLinesWorker(text.split('\n'), name);
          }
          // Add zip source info
          entryData.forEach((e) => (e.source = `${zipName}::${name}`));
          parsed.push(...entryData);
        }
        self.postMessage({ type: 'parseZipEntries', id, result: parsed });
        break;
      }

      default:
        throw new Error(`Unknown worker command: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error.message || String(error),
    });
  }
};

/**
 * Parse text lines (worker-safe version)
 */
function parseTextLinesWorker(lines, source) {
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try JSON parsing first
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      // Plain text line
      obj = { message: trimmed };
    }

    const entry = toEntry(obj, source);
    entries.push(entry);
  }
  return entries;
}

/**
 * Parse JSON file (worker-safe version)
 */
function parseJsonWorker(text, source) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((obj) => toEntry(obj, source));
    }
    return [toEntry(parsed, source)];
  } catch (err) {
    // Fallback: try NDJSON (newline-delimited JSON)
    const lines = text.split('\n').filter((l) => l.trim());
    return parseTextLinesWorker(lines, source);
  }
}

/**
 * Convert object to standardized log entry (worker-safe version)
 */
function toEntry(obj, source) {
  if (!obj || typeof obj !== 'object') {
    return {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      logger: '',
      thread: '',
      message: String(obj || ''),
      source: source || 'unknown',
      raw: obj,
    };
  }

  // Extract timestamp (various formats)
  let timestamp = obj.timestamp || obj.time || obj['@timestamp'] || obj.ts || obj.date;
  if (timestamp && typeof timestamp === 'object' && timestamp.$date) {
    timestamp = timestamp.$date; // MongoDB format
  }
  if (!timestamp) {
    timestamp = new Date().toISOString();
  }

  // Extract level
  const level =
    obj.level || obj.severity || obj.loglevel || obj.priority || obj.lvl || obj.levelname || 'INFO';

  // Extract logger/category
  const logger =
    obj.logger ||
    obj.category ||
    obj.name ||
    obj.loggerName ||
    obj.logger_name ||
    obj['@logger'] ||
    '';

  // Extract thread
  const thread = obj.thread || obj.threadName || obj.thread_name || obj.tid || '';

  // Extract message
  const message =
    obj.message || obj.msg || obj.text || obj.logMessage || obj.log_message || obj.event || '';

  // Extract trace ID (various formats)
  const traceId =
    obj.traceId ||
    obj.trace_id ||
    obj.traceid ||
    obj['x-trace-id'] ||
    obj.requestId ||
    obj.correlationId ||
    '';

  // Extract MDC/context
  let mdc = null;
  if (obj.mdc) mdc = obj.mdc;
  else if (obj.context) mdc = obj.context;
  else if (obj.properties) mdc = obj.properties;
  else if (obj.labels) mdc = obj.labels;

  // Stack trace
  const stackTrace =
    obj.stackTrace || obj.stack_trace || obj.stack || obj.exception || obj.error || '';

  // Service/app name
  const service = obj.service || obj.app || obj.application || obj.serviceName || '';

  return {
    timestamp,
    level: String(level).toUpperCase(),
    logger: String(logger),
    thread: String(thread),
    message: String(message),
    traceId: String(traceId || ''),
    source: source || 'unknown',
    mdc: mdc || {},
    stackTrace: stackTrace ? String(stackTrace) : undefined,
    service: String(service),
    raw: obj,
  };
}
