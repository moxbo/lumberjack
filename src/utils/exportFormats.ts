/**
 * Export formatters for log entries.
 * Pure functions: take entries + options, return string content.
 *
 * The HTML formatter remains in App.tsx (needs CSS-Variable access via DOM);
 * everything else lives here so it can be unit-tested in isolation.
 */
import type { LogEntry } from "../types/ipc";

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

export function exportToJson(entries: ExportEntry[]): string {
  const out = entries.map((e) => ({
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
  }));
  return JSON.stringify(out, null, 2);
}

/** Newline-delimited JSON: one entry per line, streamable. */
export function exportToNdjson(entries: ExportEntry[]): string {
  return entries
    .map((e) =>
      JSON.stringify({
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
      }),
    )
    .join("\n");
}

export function exportToCsv(entries: ExportEntry[]): string {
  const header = [
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
  const lines = entries.map((e) =>
    [
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
      .join(","),
  );
  // Prepend BOM so Excel detects UTF-8 reliably.
  return "\uFEFF" + header + "\n" + lines.join("\n");
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
