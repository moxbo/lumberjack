/**
 * Web Worker for heavy parsing operations
 * Offloads CPU-intensive parsing to a background thread
 * to keep the main thread responsive
 */

// Types
type AnyMap = Record<string, unknown>;

// Max entries per response to prevent DataCloneError (out of memory)
// Large log entries with big raw objects can exhaust memory during structured clone
const MAX_ENTRIES_PER_RESPONSE = 10000;

// Max raw object size (characters when stringified) - larger objects get truncated
const MAX_RAW_SIZE = 5000;

interface WorkerMessage {
  type: string;
  data: unknown;
  id: number;
}

interface ParseLinesData {
  lines: string[];
  filename: string;
}

interface ParseJSONData {
  text: string;
  filename: string;
}

interface ZipEntry {
  name: string;
  text: string;
}

interface ParseZipEntriesData {
  entries: ZipEntry[];
  zipName: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  thread: string;
  message: string;
  traceId: string;
  source: string;
  mdc: Record<string, unknown>;
  stackTrace?: string;
  service: string;
  raw: unknown;
}

/**
 * Truncate raw object if too large to prevent DataCloneError
 */
function truncateRaw(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;

  try {
    const stringified = JSON.stringify(raw);
    if (stringified.length > MAX_RAW_SIZE) {
      // Return a truncated version
      return {
        _truncated: true,
        _originalSize: stringified.length,
        _preview: stringified.slice(0, 500) + "...",
      };
    }
    return raw;
  } catch {
    // If we can't stringify, return a safe placeholder
    return { _error: "Could not serialize raw object" };
  }
}

/**
 * Send results in chunks if too large
 */
function sendChunkedResults(
  type: string,
  id: number,
  entries: LogEntry[],
): void {
  if (entries.length <= MAX_ENTRIES_PER_RESPONSE) {
    // Small enough to send in one message
    self.postMessage({ type, id, result: entries });
  } else {
    // Send in chunks
    const totalChunks = Math.ceil(entries.length / MAX_ENTRIES_PER_RESPONSE);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_ENTRIES_PER_RESPONSE;
      const end = Math.min(start + MAX_ENTRIES_PER_RESPONSE, entries.length);
      const chunk = entries.slice(start, end);

      self.postMessage({
        type,
        id,
        result: chunk,
        chunk: {
          index: i,
          total: totalChunks,
          isLast: i === totalChunks - 1,
        },
      });
    }
  }
}

// Worker-safe implementation of parsing logic
self.onmessage = function (e: MessageEvent<WorkerMessage>): void {
  const { type, data, id } = e.data;

  try {
    switch (type) {
      case "parseLines": {
        const { lines, filename } = data as ParseLinesData;
        const entries = parseTextLinesWorker(lines, filename);
        sendChunkedResults("parseLines", id, entries);
        break;
      }

      case "parseJSON": {
        const { text, filename } = data as ParseJSONData;
        const entries = parseJsonWorker(text, filename);
        sendChunkedResults("parseJSON", id, entries);
        break;
      }

      case "parseZipEntries": {
        const { entries: zipEntries, zipName } = data as ParseZipEntriesData;
        const parsed: LogEntry[] = [];
        for (const entry of zipEntries) {
          const { name, text } = entry;
          const parts = name.toLowerCase().split(".");
          const ext = parts[parts.length - 1] ?? "";
          let entryData: LogEntry[] = [];
          if (ext === "json") {
            entryData = parseJsonWorker(text, name);
          } else {
            entryData = parseTextLinesWorker(text.split("\n"), name);
          }
          // Add zip source info
          entryData.forEach((e) => (e.source = `${zipName}::${name}`));
          parsed.push(...entryData);
        }
        sendChunkedResults("parseZipEntries", id, parsed);
        break;
      }

      default:
        throw new Error(`Unknown worker command: ${String(type)}`);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Parse text lines (worker-safe version)
 */
function parseTextLinesWorker(lines: string[], source: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try JSON parsing first
    let obj: AnyMap | null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      obj = parsed && typeof parsed === "object" ? (parsed as AnyMap) : null;
    } catch {
      // Plain text line
      obj = { message: trimmed };
    }

    const entry = toEntry(obj ?? {}, source);
    entries.push(entry);
  }
  return entries;
}

/**
 * Parse JSON file (worker-safe version)
 */
function parseJsonWorker(text: string, source: string): LogEntry[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const obj = item && typeof item === "object" ? (item as AnyMap) : {};
        return toEntry(obj, source);
      });
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as AnyMap) : {};
    return [toEntry(obj, source)];
  } catch {
    // Fallback: try NDJSON (newline-delimited JSON)
    const lines = text.split("\n").filter((l) => l.trim());
    return parseTextLinesWorker(lines, source);
  }
}

/**
 * Convert object to standardized log entry (worker-safe version)
 */
function toEntry(obj: AnyMap, source: string): LogEntry {
  if (!obj || typeof obj !== "object") {
    return {
      timestamp: new Date().toISOString(),
      level: "INFO",
      logger: "",
      thread: "",
      message: String(obj || ""),
      source: source || "unknown",
      raw: obj,
      traceId: "",
      mdc: {},
      service: "",
    };
  }

  // Extract timestamp (various formats)
  let timestamp =
    obj.timestamp || obj.time || obj["@timestamp"] || obj.ts || obj.date;
  if (timestamp && typeof timestamp === "object") {
    const timestampObj = timestamp as AnyMap;
    if (timestampObj.$date) {
      timestamp = timestampObj.$date; // MongoDB format
    }
  }
  if (!timestamp) {
    timestamp = new Date().toISOString();
  }

  // Extract level
  const level =
    obj.level ||
    obj.severity ||
    obj.loglevel ||
    obj.priority ||
    obj.lvl ||
    obj.levelname ||
    "INFO";

  // Extract logger/category
  const logger =
    obj.logger ||
    obj.category ||
    obj.name ||
    obj.loggerName ||
    obj.logger_name ||
    obj["@logger"] ||
    "";

  // Extract thread
  const thread =
    obj.thread || obj.threadName || obj.thread_name || obj.tid || "";

  // Extract message
  const message =
    obj.message ||
    obj.msg ||
    obj.text ||
    obj.logMessage ||
    obj.log_message ||
    obj.event ||
    "";

  // Extract trace ID (various formats)
  const traceId =
    obj.traceId ||
    obj.trace_id ||
    obj.traceid ||
    obj["x-trace-id"] ||
    obj.requestId ||
    obj.correlationId ||
    "";

  // Extract MDC/context
  let mdc: AnyMap | null = null;
  if (obj.mdc) mdc = obj.mdc as AnyMap;
  else if (obj.context) mdc = obj.context as AnyMap;
  else if (obj.properties) mdc = obj.properties as AnyMap;
  else if (obj.labels) mdc = obj.labels as AnyMap;

  // Stack trace
  const stackTrace =
    obj.stackTrace ||
    obj.stack_trace ||
    obj.stack ||
    obj.exception ||
    obj.error ||
    "";

  // Service/app name
  const service =
    obj.service || obj.app || obj.application || obj.serviceName || "";

  // Helper to safely convert to string
  const safeString = (v: unknown, fallback = ""): string => {
    if (v == null) return fallback;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      return String(v);
    }
    return fallback;
  };

  return {
    timestamp: String(timestamp),
    level: safeString(level, "INFO").toUpperCase(),
    logger: safeString(logger),
    thread: safeString(thread),
    message: safeString(message),
    traceId: safeString(traceId),
    source: source || "unknown",
    mdc: (mdc as Record<string, unknown>) || {},
    stackTrace: stackTrace ? safeString(stackTrace) : undefined,
    service: safeString(service),
    raw: truncateRaw(obj),
  };
}
