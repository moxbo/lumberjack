/**
 * StatusSection Component
 *
 * Shows busy spinner, TCP status, HTTP status, and next-poll countdown
 * in the toolbar.
 */
import type { JSX } from "preact/jsx-runtime";

export interface StatusSectionProps {
  busy: boolean;
  importProgress?: { processed: number; total: number } | null;
  tcpStatus: string;
  httpStatus: string;
  /** Number of currently active HTTP-Tail watchers (0 = hidden). */
  httpTailCount?: number;
  nextPollIn: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function StatusSection({
  busy,
  importProgress,
  tcpStatus,
  httpStatus,
  httpTailCount = 0,
  nextPollIn,
  t,
}: StatusSectionProps): JSX.Element {
  // Use semantic flags by comparing against translated strings
  const isTcpActive =
    !!tcpStatus &&
    tcpStatus !== t("status.tcpStopped") &&
    tcpStatus !== t("status.tcpError");
  const isHttpActive =
    !!httpStatus && httpStatus !== t("status.httpPollStopped");
  const errorPrefix = t("status.error").split("{{")[0] || "Error";
  const isHttpError = !!httpStatus && httpStatus.startsWith(errorPrefix);

  return (
    <div
      className="section"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t("toolbar.statusRegion") || "Verbindungsstatus"}
    >
      {busy && (
        <span className="busy">
          <span className="spinner" aria-hidden="true"></span>
          <span>{t("toolbar.busy")}</span>
          {importProgress && importProgress.total > 0 && (
            <>
              <progress
                className="import-progress"
                value={importProgress.processed}
                max={importProgress.total}
                aria-label={t("toolbar.busy")}
              />
              <span className="import-progress-text">
                {Math.round(
                  (importProgress.processed / importProgress.total) * 100,
                )}
                %
              </span>
            </>
          )}
        </span>
      )}
      {/* TCP Status - show when active */}
      {isTcpActive && (
        <span id="tcpStatus" className="status status-active">
          <span aria-hidden="true">🟢 </span>
          {tcpStatus}
        </span>
      )}
      {/* HTTP Status - show when active */}
      {isHttpActive && (
        <span
          id="httpStatus"
          className={`status ${isHttpError ? "status-error" : "status-active"}`}
          role={isHttpError ? "alert" : undefined}
        >
          <span aria-hidden="true">{isHttpError ? "🔴 " : "🟢 "}</span>
          {httpStatus}
        </span>
      )}
      {/* HTTP-Tail Status - show when at least one tail is running */}
      {httpTailCount > 0 && (
        <span id="httpTailStatus" className="status status-active">
          <span aria-hidden="true">🟢 </span>
          {httpTailCount > 1
            ? t("status.httpTailingMulti", { count: String(httpTailCount) })
            : t("status.httpTailing")}
        </span>
      )}
      {nextPollIn && (
        <span className="status" title={t("toolbar.nextPollInTooltip")}>
          {nextPollIn}
        </span>
      )}
    </div>
  );
}
