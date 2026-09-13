import type { ExportEntry } from "./exportFormats";

export type ExportTranslate = (
  key: string,
  values?: Record<string, string>,
) => string;

export interface HtmlExportOptions {
  locale: string;
  exportedAt: string;
  count: number;
  labels: {
    exported: string;
    entries: string;
    filteredOf: string;
    timestamp: string;
    level: string;
    logger: string;
    message: string;
  };
  background: string;
  text: string;
  paper: string;
  levelColors: Record<string, string>;
}

/** Snapshot DOM theme and localized labels before the asynchronous export starts. */
export function captureHtmlExportOptions(
  count: number,
  total: number,
  locale: string,
  t: ExportTranslate,
  date: Date,
): HtmlExportOptions {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string): string =>
    css.getPropertyValue(`--color-${name}`).trim() || fallback;
  return {
    locale,
    count,
    exportedAt: date.toLocaleString(),
    labels: {
      exported: t("export.exported"),
      entries: t("export.entries"),
      filteredOf: t("export.filteredOf", { total: String(total) }),
      timestamp: t("list.header.timestamp"),
      level: t("list.header.level"),
      logger: t("list.header.logger"),
      message: t("list.header.message"),
    },
    background: color("bg-default", "#f5f5f7"),
    text: color("text-primary", "#1d1d1f"),
    paper: color("bg-paper", "#ffffff"),
    levelColors: {
      TRACE: color("level-trace", "#8b5cf6"),
      DEBUG: color("level-debug", "#06b6d4"),
      INFO: color("level-info", "#10b981"),
      WARN: color("level-warn", "#f59e0b"),
      WARNING: color("level-warn", "#f59e0b"),
      ERROR: color("level-error", "#ef4444"),
      FATAL: color("level-fatal", "#dc2626"),
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Persisted marks/theme values must not escape an inline CSS declaration.
function cssColor(value: string): string {
  if (/[;<>"'{}\\]/.test(value)) throw new Error("Invalid export color");
  return value;
}

export function htmlRow(
  entry: ExportEntry,
  options: HtmlExportOptions,
  fmtTimestamp: (value: unknown) => string,
): string {
  const ts = escapeHtml(fmtTimestamp(entry.timestamp));
  const level = String(entry.level || "").toUpperCase();
  const lvl = escapeHtml(level);
  const loggerName = escapeHtml(String(entry.logger || ""));
  const msg = escapeHtml(String(entry.message || ""));
  const markColor = entry._mark ? cssColor(entry._mark) : undefined;
  const levelColor = cssColor(options.levelColors[level] || options.text);
  const rowStyle = markColor
    ? `border-left: 4px solid ${markColor}; background: ${markColor}22;`
    : "border-left: 4px solid transparent;";
  return `<tr style="${rowStyle}">
            <td style="white-space: nowrap; padding: 4px 8px;">${ts}</td>
            <td style="padding: 4px 8px; text-align: center;"><span style="color: ${levelColor}; font-weight: 600;">${lvl}</span></td>
            <td style="padding: 4px 8px; color: #666;">${loggerName}</td>
            <td style="padding: 4px 8px; font-family: monospace; white-space: pre-wrap; word-break: break-word;">${msg}</td>
          </tr>`;
}

export function htmlHeader(options: HtmlExportOptions): string {
  const { labels: l } = options;
  const bgColor = cssColor(options.background);
  const textColor = cssColor(options.text);
  const bgPaper = cssColor(options.paper);
  const levelColors = Object.fromEntries(
    Object.entries(options.levelColors).map(([k, v]) => [k, cssColor(v)]),
  );
  return `<!DOCTYPE html>
<html lang="${escapeHtml(options.locale)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lumberjack Export - ${escapeHtml(options.exportedAt)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background: ${bgColor};
      color: ${textColor};
      margin: 0;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; }
    .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: ${bgPaper};
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    th {
      background: ${bgColor};
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      border-bottom: 1px solid #ddd;
    }
    tr:hover { background: rgba(0,0,0,0.02); }
    td { border-bottom: 1px solid #eee; vertical-align: top; }
    .level-trace { color: ${levelColors.TRACE}; }
    .level-debug { color: ${levelColors.DEBUG}; }
    .level-info { color: ${levelColors.INFO}; }
    .level-warn { color: ${levelColors.WARN}; }
    .level-error { color: ${levelColors.ERROR}; }
    .level-fatal { color: ${levelColors.FATAL}; }
    @media print {
      body { background: white; padding: 10px; }
      table { box-shadow: none; }
    }
  </style>
</head>
<body>
  <h1> Lumberjack Log Export</h1>
  <div class="meta">
    ${escapeHtml(l.exported)}: ${escapeHtml(options.exportedAt)}<br>
    ${escapeHtml(l.entries)}: ${options.count} (${escapeHtml(l.filteredOf)})
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 180px;">${escapeHtml(l.timestamp)}</th>
        <th style="width: 80px; text-align: center;">${escapeHtml(l.level)}</th>
        <th style="width: 200px;">${escapeHtml(l.logger)}</th>
        <th>${escapeHtml(l.message)}</th>
      </tr>
    </thead>
    <tbody>
      `;
}

export const htmlFooter = `
    </tbody>
  </table>
</body>
</html>`;
