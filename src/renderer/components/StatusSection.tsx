/**
 * StatusSection Component
 *
 * Shows busy spinner, TCP status, HTTP status, and next-poll countdown
 * in the toolbar.
 */
import type { JSX } from "preact/jsx-runtime";

export interface StatusSectionProps {
  busy: boolean;
  importProgress?: {
    processedEntries: number;
    totalEntries?: number;
    bytesRead?: number;
    totalBytes?: number;
    filePath?: string;
    fileIndex?: number;
    totalFiles?: number;
  } | null;
  tcpStatus: string;
  httpStatus: string;
  /** Number of currently active HTTP-Tail watchers (0 = hidden). */
  httpTailCount?: number;
  httpTailPausedCount?: number;
  httpTailNextPollSeconds?: number | null;
  httpTailPausedIntervalSeconds?: number;
  nextPollIn: string;
  t: (key: string, params?: Record<string, string>) => string;
}

type ImportProgress = NonNullable<StatusSectionProps["importProgress"]>;

export function getImportProgressLabels(
  progress: ImportProgress,
  t: StatusSectionProps["t"],
): string[] {
  const labels: string[] = [];
  if (
    typeof progress.fileIndex === "number" &&
    typeof progress.totalFiles === "number" &&
    progress.totalFiles > 0
  ) {
    labels.push(
      t("toolbar.importFileProgress", {
        current: String(progress.fileIndex + 1),
        total: String(progress.totalFiles),
      }),
    );
  }
  if ((progress.totalEntries || 0) > 0) {
    labels.push(
      t("toolbar.importEntryProgress", {
        current: progress.processedEntries.toLocaleString(),
        total: progress.totalEntries!.toLocaleString(),
      }),
    );
  } else {
    labels.push(
      t("toolbar.importEntriesRead", {
        count: progress.processedEntries.toLocaleString(),
      }),
    );
  }
  return labels;
}

export function getHttpTailStatusLabels(
  count: number,
  pausedCount: number,
  nextPollSeconds: number | null,
  pausedIntervalSeconds: number,
  t: StatusSectionProps["t"],
): { state: string; next: string } {
  return {
    state:
      pausedCount > 0
        ? t("status.httpTailPaused", { count: String(pausedCount) })
        : count > 1
          ? t("status.httpTailingMulti", { count: String(count) })
          : t("status.httpTailing"),
    next:
      pausedCount > 0
        ? t("status.httpTailNextAfterResume", {
            seconds: String(pausedIntervalSeconds),
          })
        : t("status.httpTailNextIn", {
            seconds: String(nextPollSeconds ?? 0),
          }),
  };
}

export function StatusSection({
  busy,
  importProgress,
  tcpStatus,
  httpStatus,
  httpTailCount = 0,
  httpTailPausedCount = 0,
  httpTailNextPollSeconds = null,
  httpTailPausedIntervalSeconds = 0,
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
  const progressValue =
    importProgress && (importProgress.totalBytes || 0) > 0
      ? importProgress.bytesRead || 0
      : importProgress?.processedEntries || 0;
  const progressMax =
    importProgress && (importProgress.totalBytes || 0) > 0
      ? importProgress.totalBytes || 0
      : importProgress?.totalEntries || 0;
  const progressPercent =
    progressMax > 0 ? Math.round((progressValue / progressMax) * 100) : 0;
  const progressLabels = importProgress
    ? getImportProgressLabels(importProgress, t)
    : [];
  const httpTailLabels = getHttpTailStatusLabels(
    httpTailCount,
    httpTailPausedCount,
    httpTailNextPollSeconds,
    httpTailPausedIntervalSeconds,
    t,
  );

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
          {importProgress && progressMax > 0 && (
            <>
              <progress
                className="import-progress"
                value={progressValue}
                max={progressMax}
                aria-label={t("toolbar.busy")}
              />
              <span className="import-progress-text">
                {progressPercent}%
                {progressLabels.length > 0
                  ? ` • ${progressLabels.join(" • ")}`
                  : ""}
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
        <span
          id="httpTailStatus"
          className={`status ${httpTailPausedCount > 0 ? "status-warning" : "status-active"}`}
        >
          <span aria-hidden="true">
            {httpTailPausedCount > 0 ? "🟡 " : "🟢 "}
          </span>
          {httpTailLabels.state}
        </span>
      )}
      {httpTailCount > 0 && (
        <span className="status">{httpTailLabels.next}</span>
      )}
      {nextPollIn && (
        <span className="status" title={t("toolbar.nextPollInTooltip")}>
          {nextPollIn}
        </span>
      )}
    </div>
  );
}
