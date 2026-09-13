/**
 * Export formatters for log entries.
 * Pure formatters and incremental serialization. Streaming retains at most one
 * serialized entry; legacy string-returning helpers remain for small callers.
 */
import type { ExportFormat, LogEntry } from "../types/ipc";
import {
  htmlFooter,
  htmlHeader,
  htmlRow,
  type HtmlExportOptions,
} from "./htmlExport";

export interface ExportEntry extends Partial<LogEntry> {
  _mark?: string;
}

/** Format a timestamp safely; returns empty string for invalid input. */
function fmtTs(ts: unknown): string {
  if (ts == null) return "";
  if (typeof ts === "string") return ts;
  if (typeof ts === "number") return new Date(ts).toISOString();
  return String(ts);
}

/** RFC 4180 CSV field escaping. */
function csvField(v: unknown): string {
  const s =
    v == null
      ? ""
      : typeof v === "string"
        ? v
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
  // Quote if contains comma, quote, newline or carriage return.
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Markdown table cell escaping (escape pipe + collapse whitespace). */
function mdCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ⏎ ");
}

function jsonEntry(e: ExportEntry) {
  return {
    timestamp: e?.timestamp,
    level: e?.level,
    logger: e?.logger,
    thread: e?.thread,
    message: e?.message,
    source: e?.source,
    traceId: e?.traceId,
    spanId: e?.spanId,
    stackTrace: e?.stackTrace,
    mdc: e?.mdc,
    markColor: e?._mark || null,
  };
}

export function exportToJson(entries: ExportEntry[]): string {
  return JSON.stringify(entries.map(jsonEntry), null, 2);
}

/** Newline-delimited JSON: one entry per line, streamable. */
export function exportToNdjson(entries: ExportEntry[]): string {
  return entries.map((e) => JSON.stringify(jsonEntry(e))).join("\n");
}

const CSV_HEADER = [
  "timestamp",
  "level",
  "logger",
  "thread",
  "message",
  "source",
  "traceId",
  "spanId",
  "markColor",
]
  .map(csvField)
  .join(",");
function csvRow(e: ExportEntry): string {
  return [
    fmtTs(e?.timestamp),
    e?.level ?? "",
    e?.logger ?? "",
    e?.thread ?? "",
    e?.message ?? "",
    e?.source ?? "",
    e?.traceId ?? "",
    e?.spanId ?? "",
    e?._mark ?? "",
  ]
    .map(csvField)
    .join(",");
}

export function exportToCsv(entries: ExportEntry[]): string {
  // Prepend BOM so Excel detects UTF-8 reliably.
  return "\uFEFF" + CSV_HEADER + "\n" + entries.map(csvRow).join("\n");
}

export function exportToMarkdown(
  entries: ExportEntry[],
  meta?: { exportedAt?: string; total?: number },
): string {
  const head = "| Timestamp | Level | Logger | Message |";
  const sep = "| --- | --- | --- | --- |";
  const rows = entries.map(
    (e) =>
      `| ${mdCell(fmtTs(e?.timestamp))} | ${mdCell(e?.level)} | ${mdCell(
        e?.logger,
      )} | ${mdCell(e?.message)} |`,
  );
  const headerLines: string[] = ["# Lumberjack Log Export", ""];
  if (meta?.exportedAt) {
    headerLines.push(`_Exported: ${meta.exportedAt}_`);
  }
  if (meta?.total != null) {
    headerLines.push(`_Entries: ${entries.length} of ${meta.total}_`);
  }
  headerLines.push("");
  return [...headerLines, head, sep, ...rows].join("\n");
}

export function exportToTxt(
  entries: ExportEntry[],
  fmtTimestamp: (v: unknown) => string,
): string {
  return entries
    .map((e) => {
      const ts = fmtTimestamp(e?.timestamp);
      const lvl = String(e?.level || "").padEnd(5);
      const loggerVal = String(e?.logger || "");
      const msg = String(e?.message || "");
      return `${ts} [${lvl}] ${loggerVal} - ${msg}`;
    })
    .join("\n");
}

export interface StreamExportOptions {
  count: number;
  total?: number;
  exportedAt?: string;
  fmtTimestamp: (value: unknown) => string;
  html?: HtmlExportOptions;
}

/** No aggregate payload array or output string is constructed by this path. */
export async function* streamExport(
  format: ExportFormat,
  entries: AsyncIterable<ExportEntry> | Iterable<ExportEntry>,
  options: StreamExportOptions,
): AsyncGenerator<string> {
  if (format === "json") yield options.count ? "[\n" : "[]";
  else if (format === "csv") yield "\uFEFF" + CSV_HEADER + "\n";
  else if (format === "md") {
    const header = ["# Lumberjack Log Export", ""];
    if (options.exportedAt) header.push(`_Exported: ${options.exportedAt}_`);
    if (options.total != null)
      header.push(`_Entries: ${options.count} of ${options.total}_`);
    header.push(
      "",
      "| Timestamp | Level | Logger | Message |",
      "| --- | --- | --- | --- |",
    );
    yield header.join("\n");
  } else if (format === "html") {
    if (!options.html) throw new Error("HTML export options are required");
    yield htmlHeader(options.html);
  } else if (format !== "ndjson" && format !== "txt") {
    throw new Error(`Unsupported export format: ${String(format)}`);
  }

  let count = 0;
  for await (const entry of entries) {
    if (count >= options.count) throw new Error("Export entry count changed");
    if (format === "json") {
      if (count) yield ",\n";
      yield JSON.stringify(jsonEntry(entry), null, 2).replace(/^/gm, "  ");
    } else {
      if (count || format === "md") yield "\n";
      if (format === "ndjson") yield JSON.stringify(jsonEntry(entry));
      else if (format === "csv") yield csvRow(entry);
      else if (format === "txt")
        yield exportToTxt([entry], options.fmtTimestamp);
      else if (format === "md") {
        yield `| ${mdCell(fmtTs(entry.timestamp))} | ${mdCell(entry.level)} | ${mdCell(entry.logger)} | ${mdCell(entry.message)} |`;
      } else yield htmlRow(entry, options.html!, options.fmtTimestamp);
    }
    count++;
  }
  if (count !== options.count) throw new Error("Export entry count changed");
  if (format === "json" && count) yield "\n]";
  if (format === "html") yield htmlFooter;
}
