import { Fragment } from "preact";
import { memo } from "preact/compat";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { useHighlightedHtml } from "../../hooks/useHighlightedHtml";
import { heavyFieldStore, type HeavyRecord } from "../../store/heavyFieldStore";
import type { PagedLogEntry } from "../../store/paged/types";
import { useI18n } from "../../utils/i18n";
import { levelClass, fmtTimestamp, computeTint, fmt } from "../../utils/format";
import logger from "../../utils/logger";
import "./DetailPanel.css";

type InspectorEntry = Partial<PagedLogEntry>;
type InspectorTab = "message" | "stacktrace" | "context" | "raw";
const TABS: InspectorTab[] = ["message", "stacktrace", "context", "raw"];
const RAW_PREVIEW_LIMIT = 64 * 1024;

export interface DetailPanelProps {
  selectedEntry: InspectorEntry | null;
  mdcPairs: Array<[string, string]>;
  search: string;
  onAddMdcToFilter: (key: string, value: string) => void;
  onFilterByLogger?: (logger: string) => void;
  onFilterByThread?: (thread: string) => void;
  onClose?: () => void;
  onError?: (message: string) => void;
  markColor?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Bound traversal as well as output: stringifying then slicing still blocks on
// multi-megabyte payloads. Preview markers intentionally are not export JSON.
export function createRawPreview(
  value: unknown,
  overrides?: Record<string, unknown>,
): {
  text: string;
  truncated: boolean;
} {
  let remaining = RAW_PREVIEW_LIMIT;
  let nodes = 0;
  let truncated = false;
  const ancestors = new WeakSet<object>();
  const parts: string[] = [];
  const append = (text: string) => {
    if (text.length > remaining) truncated = true;
    parts.push(text.slice(0, remaining));
    remaining = Math.max(0, remaining - text.length);
  };
  const visit = (item: unknown, depth: number) => {
    if (!remaining) {
      truncated = true;
      return;
    }
    if (++nodes > 2000 || depth > 12) {
      truncated = true;
      append('"…"');
      return;
    }
    if (typeof item === "string") {
      if (item.length > remaining) truncated = true;
      append(JSON.stringify(item.slice(0, remaining)));
    } else if (item === null || typeof item !== "object") {
      append(
        typeof item === "bigint"
          ? JSON.stringify(String(item))
          : (JSON.stringify(item) ?? "null"),
      );
    } else if (item instanceof Date) {
      append(JSON.stringify(item));
    } else if (ancestors.has(item)) {
      append('"[Circular]"');
    } else {
      ancestors.add(item);
      const array = Array.isArray(item);
      append(array ? "[" : "{");
      let count = 0;
      const property = (key: string, source: Record<string, unknown>) => {
        if (!remaining || nodes >= 2000) {
          truncated = true;
          return false;
        }
        append(`${count++ ? "," : ""}\n${"  ".repeat(depth + 1)}`);
        if (!array) {
          if (key.length > remaining) truncated = true;
          append(`${JSON.stringify(key.slice(0, remaining))}: `);
        }
        visit(source[key], depth + 1);
        return true;
      };
      const rootOverrides = depth === 0 ? overrides : undefined;
      if (rootOverrides) {
        for (const key in rootOverrides) {
          if (!property(key, rootOverrides)) break;
        }
      }
      for (const key in item) {
        if (
          !Object.prototype.hasOwnProperty.call(item, key) ||
          (rootOverrides &&
            Object.prototype.hasOwnProperty.call(rootOverrides, key))
        )
          continue;
        if (!property(key, item as Record<string, unknown>)) break;
      }
      if (count) append(`\n${"  ".repeat(depth)}`);
      append(array ? "]" : "}");
      ancestors.delete(item);
    }
  };
  visit(value, 0);
  return { text: parts.join(""), truncated };
}

function InspectorIcon({
  name,
}: {
  name: "copy" | "close" | "filter" | "entry";
}) {
  const paths = {
    copy: "M8 8h12v13H8zM16 8V3H3v13h5",
    close: "m6 6 12 12M6 18 18 6",
    filter: "M3 4h18l-7 8v7l-4 2v-9z",
    entry: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function DetailPanelComponent({
  selectedEntry,
  mdcPairs,
  search,
  onAddMdcToFilter,
  onFilterByLogger,
  onFilterByThread,
  onClose,
  onError,
  markColor,
}: DetailPanelProps) {
  const { t } = useI18n();
  const reportUnavailable = useRef(() => onError?.(t("inspector.unavailable")));
  reportUnavailable.current = () => onError?.(t("inspector.unavailable"));
  const id = useId();
  const [tab, setTab] = useState<InspectorTab>("message");
  const [fullMessageEntry, setFullMessageEntry] =
    useState<InspectorEntry | null>(null);
  const [copyStatus, setCopyStatus] = useState<{
    entry: InspectorEntry;
    error: boolean;
  } | null>(null);
  const [heavyFields, setHeavyFields] = useState<{
    entry: InspectorEntry;
    record?: HeavyRecord;
    settled: boolean;
    failed?: boolean;
  } | null>(null);
  const entryId = selectedEntry?._id;
  const offloaded = selectedEntry?._offloaded === true;

  useEffect(() => {
    setFullMessageEntry(null);
    setCopyStatus(null);
  }, [selectedEntry]);

  useEffect(() => {
    let cancelled = false;
    if (!offloaded || entryId === undefined || !selectedEntry) {
      setHeavyFields(null);
      return;
    }
    setHeavyFields({ entry: selectedEntry, settled: false });
    void heavyFieldStore.get(entryId).then(
      (record) => {
        if (!cancelled)
          setHeavyFields({ entry: selectedEntry, record, settled: true });
      },
      (error: unknown) => {
        logger.error("Failed to load inspector heavy fields:", error);
        if (!cancelled) {
          setHeavyFields({ entry: selectedEntry, settled: true, failed: true });
          reportUnavailable.current();
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entryId, offloaded, selectedEntry]);

  const heavy = heavyFields?.entry === selectedEntry ? heavyFields : null;
  const loadingHeavy = offloaded && entryId !== undefined && !heavy?.settled;
  const effectiveStackTrace =
    heavy?.record?.stackTrace ||
    fmt(selectedEntry?.stack_trace) ||
    selectedEntry?.stackTrace ||
    "";
  const effectiveFullMessage =
    heavy?.record?._fullMessage ||
    selectedEntry?._fullMessage ||
    selectedEntry?.message ||
    "";
  const isTruncated = selectedEntry?._truncated === true;
  const fullMessageAvailable =
    !isTruncated ||
    Boolean(heavy?.record?._fullMessage || selectedEntry?._fullMessage);
  const showFullMessage =
    selectedEntry !== null && fullMessageEntry === selectedEntry;
  const displayedMessage = showFullMessage
    ? effectiveFullMessage
    : selectedEntry?.message || "";
  const highlightedMessage = useHighlightedHtml(
    tab === "message" ? displayedMessage : "",
    search,
  );
  const effectiveMark =
    markColor || fmt(selectedEntry?._mark) || fmt(selectedEntry?.color) || null;
  const messageSize =
    heavy?.record?._messageSize ||
    (typeof selectedEntry?._messageSize === "number"
      ? selectedEntry._messageSize
      : effectiveFullMessage.length);
  const rawPreview = useMemo(() => {
    if (tab !== "raw" || !selectedEntry) return null;
    const raw = selectedEntry.raw;
    return createRawPreview(
      raw ?? selectedEntry,
      raw == null
        ? {
            ...(heavy?.record ?? {}),
            message: effectiveFullMessage,
            stackTrace: effectiveStackTrace,
          }
        : undefined,
    );
  }, [
    tab,
    selectedEntry,
    heavy?.record,
    effectiveFullMessage,
    effectiveStackTrace,
  ]);

  const copyMessage = async () => {
    if (!selectedEntry) return;
    try {
      await navigator.clipboard.writeText(effectiveFullMessage);
    } catch {
      setCopyStatus({ entry: selectedEntry, error: true });
      onError?.(t("inspector.copyFailed"));
      return;
    }
    setCopyStatus({ entry: selectedEntry, error: false });
  };

  const metadata = selectedEntry && (
    <section
      className="inspector-metadata"
      aria-label={t("inspector.entryContext")}
    >
      <h3>{t("inspector.entryContext")}</h3>
      <dl>
        <div>
          <dt>{t("details.time")}</dt>
          <dd>{fmtTimestamp(selectedEntry.timestamp)}</dd>
        </div>
        <div>
          <dt>{t("details.logger")}</dt>
          <dd>
            <span>{fmt(selectedEntry.logger) || "—"}</span>
            {onFilterByLogger && selectedEntry.logger && (
              <button
                type="button"
                className="inspector-icon-button"
                title={t("details.filterByLogger")}
                aria-label={t("details.filterByLogger")}
                onClick={() => onFilterByLogger(selectedEntry.logger!)}
              >
                <InspectorIcon name="filter" />
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("details.thread")}</dt>
          <dd>
            <span>{fmt(selectedEntry.thread) || "—"}</span>
            {onFilterByThread && selectedEntry.thread && (
              <button
                type="button"
                className="inspector-icon-button"
                title={t("details.filterByThread")}
                aria-label={t("details.filterByThread")}
                onClick={() => onFilterByThread(selectedEntry.thread!)}
              >
                <InspectorIcon name="filter" />
              </button>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );

  return (
    <section
      className="details inspector"
      aria-label={t("inspector.title")}
      data-tinted={effectiveMark ? "1" : "0"}
      style={{
        "--details-tint": computeTint(effectiveMark, 0.12) || "transparent",
      }}
    >
      {!selectedEntry ? (
        <div className="inspector-empty">
          <InspectorIcon name="entry" />
          <strong>{t("details.noSelection")}</strong>
          <span>{t("details.emptyHint")}</span>
          {onClose && (
            <button type="button" onClick={onClose}>
              {t("inspector.close")}
            </button>
          )}
        </div>
      ) : (
        <Fragment>
          <header className="inspector-heading">
            <span
              className={`inspector-level ${levelClass(selectedEntry.level)}`}
            >
              {fmt(selectedEntry.level) || "—"}
            </span>
            <strong
              className="inspector-logger"
              title={fmt(selectedEntry.logger)}
            >
              {fmt(selectedEntry.logger) || t("inspector.title")}
            </strong>
            <span className="inspector-timestamp">
              {fmtTimestamp(selectedEntry.timestamp)}
            </span>
            <div className="inspector-heading-actions">
              <button
                type="button"
                onClick={() => void copyMessage()}
                disabled={!fullMessageAvailable}
                title={t("inspector.copyMessage")}
                aria-label={t("inspector.copyMessage")}
              >
                <InspectorIcon name="copy" />
                <span>{t("inspector.copy")}</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  className="inspector-icon-button"
                  onClick={onClose}
                  title={t("inspector.close")}
                  aria-label={t("inspector.close")}
                >
                  <InspectorIcon name="close" />
                </button>
              )}
            </div>
          </header>
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label={t("inspector.title")}
          >
            {TABS.map((name, index) => (
              <button
                type="button"
                key={name}
                id={`${id}-tab-${name}`}
                role="tab"
                aria-selected={tab === name}
                aria-controls={`${id}-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % TABS.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + TABS.length - 1) % TABS.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = TABS.length - 1;
                  else return;
                  event.preventDefault();
                  setTab(TABS[next]!);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus();
                }}
              >
                {t(`inspector.${name}`)}
                {name === "context" && mdcPairs.length > 0 && (
                  <span className="inspector-count">{mdcPairs.length}</span>
                )}
              </button>
            ))}
          </div>
          {copyStatus?.entry === selectedEntry && (
            <div
              className="inspector-notice"
              role={copyStatus.error ? "alert" : "status"}
            >
              {t(
                copyStatus.error ? "inspector.copyFailed" : "inspector.copied",
              )}
            </div>
          )}
          {heavy?.failed && (
            <div className="inspector-notice" role="alert">
              {t("inspector.unavailable")}
            </div>
          )}
          <div
            className={`inspector-body inspector-body-${tab}`}
            role="tabpanel"
            id={`${id}-panel-${tab}`}
            aria-labelledby={`${id}-tab-${tab}`}
            tabIndex={0}
          >
            {tab === "message" && (
              <Fragment>
                <section className="inspector-message">
                  <div className="inspector-section-heading">
                    <h3>{t("inspector.message")}</h3>
                    <span title={t("details.messageSize")}>
                      {formatSize(messageSize)}
                    </span>
                    {isTruncated && (
                      <button
                        type="button"
                        aria-pressed={showFullMessage}
                        disabled={!fullMessageAvailable}
                        onClick={() =>
                          setFullMessageEntry(
                            showFullMessage ? null : selectedEntry,
                          )
                        }
                        title={t(
                          showFullMessage
                            ? "details.truncatedView"
                            : "details.fullViewTooltip",
                        )}
                      >
                        {t(
                          showFullMessage
                            ? "details.truncatedLabel"
                            : "details.fullLabel",
                        )}
                      </button>
                    )}
                  </div>
                  {isTruncated && !showFullMessage && (
                    <p className="inspector-hint">
                      {t("details.messageTruncated")}
                    </p>
                  )}
                  {isTruncated && !fullMessageAvailable && (
                    <p className="inspector-hint" role="status">
                      {t(
                        loadingHeavy
                          ? "details.loading"
                          : "inspector.unavailable",
                      )}
                    </p>
                  )}
                  <pre
                    id="dMessage"
                    className="inspector-code"
                    dangerouslySetInnerHTML={{ __html: highlightedMessage }}
                  />
                </section>
                {metadata}
              </Fragment>
            )}
            {tab === "stacktrace" &&
              (effectiveStackTrace ? (
                <pre className="inspector-code">{effectiveStackTrace}</pre>
              ) : (
                <p className="inspector-hint" role="status">
                  {t(
                    loadingHeavy
                      ? "details.loading"
                      : selectedEntry._hasStack
                        ? "inspector.unavailable"
                        : "inspector.noStacktrace",
                  )}
                </p>
              ))}
            {tab === "context" && (
              <Fragment>
                {metadata}
                <section className="inspector-context">
                  <h3>{t("details.diagnosticContext")}</h3>
                  {mdcPairs.length === 0 ? (
                    <p className="inspector-hint">{t("inspector.noContext")}</p>
                  ) : (
                    <dl>
                      {mdcPairs.map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            <code>{value}</code>
                            <button
                              type="button"
                              className="inspector-icon-button"
                              title={t("details.addToFilter")}
                              aria-label={`${t("details.addToFilter")}: ${key}`}
                              onClick={() => onAddMdcToFilter(key, value)}
                            >
                              <InspectorIcon name="filter" />
                            </button>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              </Fragment>
            )}
            {tab === "raw" && rawPreview && (
              <section>
                <p className="inspector-hint">{t("inspector.rawHint")}</p>
                {rawPreview.truncated && (
                  <p className="inspector-hint" role="status">
                    {t("inspector.rawTruncated")}
                  </p>
                )}
                <pre className="inspector-code">{rawPreview.text}</pre>
              </section>
            )}
          </div>
        </Fragment>
      )}
    </section>
  );
}

// Existing filter callbacks are recreated by App but semantically stable.
// New optional actions must update when their behavior or presence changes.
export const DetailPanel = memo(
  DetailPanelComponent,
  (prev, next) =>
    prev.selectedEntry === next.selectedEntry &&
    prev.mdcPairs === next.mdcPairs &&
    prev.search === next.search &&
    prev.markColor === next.markColor &&
    Boolean(prev.onFilterByLogger) === Boolean(next.onFilterByLogger) &&
    Boolean(prev.onFilterByThread) === Boolean(next.onFilterByThread) &&
    prev.onClose === next.onClose &&
    prev.onError === next.onError,
);
