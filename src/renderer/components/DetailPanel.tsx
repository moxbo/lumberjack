/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
/**
 * Detail Panel Component - Zeigt Details zum ausgewählten Log-Eintrag
 */
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { useI18n } from "../../utils/i18n";
import { highlightAll } from "../../utils/highlight";
import { levelClass, fmtTimestamp, computeTint, fmt } from "../../utils/format";

/**
 * Format byte size to human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Get the actual message size (from _messageSize if truncated, otherwise calculate)
 */
function getMessageSize(entry: any): number {
  if (entry._messageSize) return entry._messageSize;
  if (entry._fullMessage) return entry._fullMessage.length;
  return (entry.message || "").length;
}

/**
 * Get the full message (from _fullMessage if truncated, otherwise message)
 */
function getFullMessage(entry: any): string {
  return entry._fullMessage || entry.message || "";
}

interface DetailPanelProps {
  selectedEntry: any | null;
  mdcPairs: Array<[string, string]>;
  search: string;
  onAddMdcToFilter: (key: string, value: string) => void;
  onFilterByLogger?: (logger: string) => void;
  onFilterByThread?: (thread: string) => void;
}

export function DetailPanel({
  selectedEntry,
  mdcPairs,
  search,
  onAddMdcToFilter,
  onFilterByLogger,
  onFilterByThread,
}: DetailPanelProps) {
  const { t } = useI18n();
  const [showFullMessage, setShowFullMessage] = useState(false);

  // Reset showFullMessage when selected entry changes
  const isTruncated = selectedEntry?._truncated === true;
  const messageSize = selectedEntry ? getMessageSize(selectedEntry) : 0;

  return (
    <div
      className="details"
      data-tinted={
        selectedEntry && (selectedEntry._mark || selectedEntry.color)
          ? "1"
          : "0"
      }
      style={{
        ["--details-tint" as any]: computeTint(
          (selectedEntry && selectedEntry._mark) || selectedEntry?.color,
          0.22,
        ),
      }}
    >
      {!selectedEntry && (
        <div className="details-empty">
          <div className="details-empty-icon">👆</div>
          <div className="details-empty-title">{t("details.noSelection")}</div>
          <div className="details-empty-hint">{t("details.emptyHint")}</div>
        </div>
      )}

      {selectedEntry && (
        <Fragment>
          <div className="meta-grid">
            <div>
              <div className="kv">
                <span>{t("details.time")}</span>
                <div>{fmtTimestamp(selectedEntry.timestamp)}</div>
              </div>
              <div className="kv">
                <span>{t("details.logger")}</span>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <span style={{ flex: 1 }}>{fmt(selectedEntry.logger)}</span>
                  {onFilterByLogger && selectedEntry.logger && (
                    <button
                      className="filter-action-btn"
                      onClick={() =>
                        onFilterByLogger(String(selectedEntry.logger))
                      }
                      title={t("details.filterByLogger")}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <div className="kv">
                <span>{t("details.level")}</span>
                <div>
                  <span className={levelClass(selectedEntry.level)}>
                    {fmt(selectedEntry.level)}
                  </span>
                </div>
              </div>
              <div className="kv">
                <span>{t("details.thread")}</span>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <span style={{ flex: 1 }}>{fmt(selectedEntry.thread)}</span>
                  {onFilterByThread && selectedEntry.thread && (
                    <button
                      className="filter-action-btn"
                      onClick={() =>
                        onFilterByThread(String(selectedEntry.thread))
                      }
                      title={t("details.filterByThread")}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="section-sep" />

          <div className="kv full">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              {t("details.message")}
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--color-text-secondary, #666)",
                  fontWeight: "normal",
                }}
                title="Nachrichtengröße"
              >
                ({formatSize(messageSize)})
              </span>
              {isTruncated && (
                <button
                  onClick={() => setShowFullMessage(!showFullMessage)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    background: showFullMessage
                      ? "var(--color-primary, #007acc)"
                      : "var(--color-bg-secondary, #f0f0f0)",
                    color: showFullMessage
                      ? "white"
                      : "var(--color-text-secondary, #666)",
                    border: "1px solid var(--color-border, #ddd)",
                    borderRadius: "4px",
                  }}
                  title={
                    showFullMessage
                      ? "Gekürzte Ansicht"
                      : "Vollständige Nachricht anzeigen (kann bei großen Nachrichten langsam sein)"
                  }
                >
                  {showFullMessage ? "▼ Gekürzt" : "▶ Vollständig"}
                </button>
              )}
              {isTruncated && !showFullMessage && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--color-warning, #f0ad4e)",
                  }}
                >
                  ⚠️ Nachricht gekürzt
                </span>
              )}
            </span>
            <pre
              id="dMessage"
              style={{
                maxHeight: showFullMessage ? "none" : "400px",
                overflow: showFullMessage ? "auto" : "auto",
              }}
              dangerouslySetInnerHTML={{
                __html: highlightAll(
                  showFullMessage
                    ? getFullMessage(selectedEntry)
                    : selectedEntry.message || "",
                  search,
                ),
              }}
            />
          </div>

          {(selectedEntry.stack_trace || selectedEntry.stackTrace) && (
            <div className="kv full">
              <span>{t("details.stacktrace")}</span>
              <pre className="stack-trace">
                {String(
                  selectedEntry.stack_trace || selectedEntry.stackTrace || "",
                )}
              </pre>
            </div>
          )}

          {mdcPairs.length > 0 && (
            <Fragment>
              <div className="section-sep" />
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}
              >
                {t("details.diagnosticContext")}
              </div>
              <div className="mdc-grid">
                {mdcPairs.map(([k, v]) => (
                  <Fragment key={k + "=" + v}>
                    <div className="mdc-key">{k}</div>
                    <div className="mdc-val">
                      <code>{v}</code>
                    </div>
                    <div
                      className="mdc-act"
                      style={{
                        display: "flex",
                        gap: "6px",
                        justifyContent: "end",
                      }}
                    >
                      <button
                        onClick={() => onAddMdcToFilter(k, v)}
                        title={t("details.addToFilter")}
                      >
                        +
                      </button>
                    </div>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          )}
        </Fragment>
      )}
    </div>
  );
}
