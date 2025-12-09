// Detail panel with progressive disclosure for stack traces and MDC
import { useState } from "preact/hooks";
import { JSX } from "preact/jsx-runtime";
import {
  computeTint,
  fmtTimestamp,
  getStr,
  getTs,
  levelClass,
} from "../utils/format";

interface DetailPanelProps {
  entry: Record<string, unknown> | null;
  search: string;
  highlightFn: (text: string, search: string) => string;
  t: (key: string) => string;
  markColor?: string;
}

/**
 * Get the full message from an entry, preferring _fullMessage if available
 */
function getFullMessage(entry: Record<string, unknown>): string {
  // Check for preserved full message (when truncated)
  const fullMessage = entry._fullMessage;
  if (typeof fullMessage === "string" && fullMessage.length > 0) {
    return fullMessage;
  }
  // Fall back to regular message
  return getStr(entry, "message");
}

/**
 * Check if entry was truncated
 */
function isTruncated(entry: Record<string, unknown>): boolean {
  return entry._truncated === true || typeof entry._fullMessage === "string";
}

export function DetailPanel({
  entry,
  search,
  highlightFn,
  t,
  markColor,
}: DetailPanelProps): JSX.Element {
  const [stackExpanded, setStackExpanded] = useState(false);
  const [mdcExpanded, setMdcExpanded] = useState(false);
  const [messageExpanded, setMessageExpanded] = useState(false);

  if (!entry) {
    return (
      <div style={{ color: "var(--color-text-secondary)" }}>
        {t("details.noSelection")}
      </div>
    );
  }

  const hasStackTrace = !!(
    getStr(entry, "stack_trace") || getStr(entry, "stackTrace")
  );
  const mdcRaw = entry["mdc" as keyof typeof entry];
  const mdc =
    mdcRaw && typeof mdcRaw === "object"
      ? (mdcRaw as Record<string, unknown>)
      : undefined;
  const hasMdc = mdc && Object.keys(mdc).length > 0;

  return (
    <div
      data-tinted={markColor ? "1" : "0"}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--details-tint" as any]: computeTint(markColor, 0.22),
      }}
    >
      <div className="meta-grid">
        <div>
          <div className="kv">
            <span>{t("details.time")}</span>
            <div>{fmtTimestamp(getTs(entry, "timestamp") ?? null)}</div>
          </div>
          <div className="kv">
            <span>{t("details.logger")}</span>
            <div>{getStr(entry, "logger")}</div>
          </div>
        </div>
        <div>
          <div className="kv">
            <span>{t("details.level")}</span>
            <div>
              <span className={levelClass(getStr(entry, "level"))}>
                {getStr(entry, "level")}
              </span>
            </div>
          </div>
          <div className="kv">
            <span>{t("details.thread")}</span>
            <div>{getStr(entry, "thread")}</div>
          </div>
        </div>
      </div>

      <div className="section-sep" />

      <div className="kv full">
        <span>
          {t("details.message")}
          {isTruncated(entry) && (
            <button
              onClick={() => setMessageExpanded(!messageExpanded)}
              style={{
                marginLeft: "8px",
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: "4px",
                color: "var(--color-text-secondary)",
              }}
              title={
                messageExpanded
                  ? "Nachricht kürzen"
                  : "Vollständige Nachricht anzeigen"
              }
            >
              {messageExpanded ? "▼ Gekürzt" : "▶ Vollständig"}
            </button>
          )}
        </span>
        <pre
          id="dMessage"
          style={{
            maxHeight: messageExpanded ? "none" : "400px",
            overflow: messageExpanded ? "visible" : "auto",
          }}
          dangerouslySetInnerHTML={{
            __html: highlightFn(
              messageExpanded
                ? getFullMessage(entry)
                : getStr(entry, "message"),
              search,
            ),
          }}
        />
      </div>

      {/* Progressive disclosure for stack trace */}
      {hasStackTrace && (
        <div className="kv full">
          <span
            onClick={() => setStackExpanded(!stackExpanded)}
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            {stackExpanded ? "▼" : "▶"} {t("details.stacktrace")}
          </span>
          {stackExpanded && (
            <pre className="stack-trace">
              {String(
                getStr(entry, "stack_trace") || getStr(entry, "stackTrace"),
              )}
            </pre>
          )}
        </div>
      )}

      {/* Progressive disclosure for MDC */}
      {hasMdc && (
        <div className="kv full">
          <span
            onClick={() => setMdcExpanded(!mdcExpanded)}
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            {mdcExpanded ? "▼" : "▶"} MDC ({Object.keys(mdc || {}).length})
          </span>
          {mdcExpanded && (
            <div style={{ marginTop: "8px" }}>
              {Object.entries(mdc || {}).map(([key, value]) => (
                <div key={key} style={{ marginBottom: "4px" }}>
                  <strong>{key}:</strong> {String(value)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Display other relevant fields */}
      {getStr(entry, "traceId") && (
        <div className="kv full">
          <span>{t("details.traceId") || "Trace ID"}</span>
          <div>{getStr(entry, "traceId")}</div>
        </div>
      )}

      {getStr(entry, "service") && (
        <div className="kv full">
          <span>{t("details.service") || "Service"}</span>
          <div>{getStr(entry, "service")}</div>
        </div>
      )}
    </div>
  );
}
