/**
 * UpdateNotification Component
 * Displays a notification when a new app update is available
 * Allows the user to download, install, or dismiss the update
 */

import { useCallback, useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { useI18n } from "../../utils/i18n";
import logger from "../../utils/logger";
import {
  onAutoUpdaterStatus,
  autoUpdaterDownload,
  autoUpdaterInstall,
  autoUpdaterCheck,
  autoUpdaterOpenReleasePage,
} from "../../utils/typedApi";

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ version: string; note: string }>;
}

interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "available-portable";
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
  isPortable?: boolean;
}

export function UpdateNotification(): VNode | null {
  const { t } = useI18n();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isStartingDownload, setIsStartingDownload] = useState(false);

  // Listen for update status changes from main process
  useEffect(() => {
    const unsubscribe = onAutoUpdaterStatus((status: UpdateStatus) => {
      logger.info("[UpdateNotification] Received status:", status);
      setUpdateStatus(status);

      // Reset isStartingDownload when download actually starts or on error
      if (status.status === "downloading" || status.status === "error") {
        setIsStartingDownload(false);
      }

      // Reset dismissed state when a new update becomes available
      if (
        status.status === "available" ||
        status.status === "available-portable"
      ) {
        setDismissed(false);
        setIsStartingDownload(false);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      setIsStartingDownload(true);
      logger.info("[UpdateNotification] Starting download...");
      await autoUpdaterDownload();
    } catch (error) {
      logger.error("[UpdateNotification] Download failed:", error);
      setIsStartingDownload(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      logger.info("[UpdateNotification] Installing update...");
      await autoUpdaterInstall();
    } catch (error) {
      logger.error("[UpdateNotification] Install failed:", error);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    try {
      logger.info("[UpdateNotification] Manual update check...");
      await autoUpdaterCheck();
    } catch (error) {
      logger.error("[UpdateNotification] Update check failed:", error);
    }
  }, []);

  const handleOpenReleasePage = useCallback(async () => {
    try {
      logger.info("[UpdateNotification] Opening release page...");
      await autoUpdaterOpenReleasePage();
    } catch (error) {
      logger.error("[UpdateNotification] Failed to open release page:", error);
    }
  }, []);

  // Don't show if dismissed or no relevant status
  if (dismissed || !updateStatus) {
    return null;
  }

  // Only show for these statuses
  const showableStatuses = [
    "available",
    "available-portable",
    "downloading",
    "downloaded",
    "error",
  ];
  if (!showableStatuses.includes(updateStatus.status)) {
    return null;
  }

  const version = updateStatus.info?.version || "?";
  const progress = updateStatus.progress;

  // Format release notes
  const releaseNotes = updateStatus.info?.releaseNotes;
  let notesText = "";
  if (typeof releaseNotes === "string") {
    notesText = releaseNotes;
  } else if (Array.isArray(releaseNotes) && releaseNotes.length > 0) {
    notesText = releaseNotes.map((n) => `${n.version}: ${n.note}`).join("\n");
  }

  return (
    <div className="update-notification" data-status={updateStatus.status}>
      <div className="update-notification-content">
        {/* Icon */}
        <span className="update-notification-icon">
          {updateStatus.status === "error" ? "⚠️" : "🔄"}
        </span>

        {/* Main content */}
        <div className="update-notification-text">
          {updateStatus.status === "available" && (
            <>
              <strong>{t("update.available", { version })}</strong>
              <span className="update-notification-hint">
                {t("update.availableHint")}
              </span>
            </>
          )}

          {updateStatus.status === "available-portable" && (
            <>
              <strong>{t("update.portableAvailable", { version })}</strong>
              <span className="update-notification-hint">
                {t("update.portableHint")}
              </span>
            </>
          )}

          {updateStatus.status === "downloading" && (
            <>
              <strong>{t("update.downloading")}</strong>
              {progress && (
                <div className="update-progress">
                  <div className="update-progress-bar">
                    <div
                      className="update-progress-fill"
                      style={{ width: `${Math.min(100, progress.percent)}%` }}
                    />
                  </div>
                  <span className="update-progress-text">
                    {progress.percent.toFixed(0)}% (
                    {formatBytes(progress.bytesPerSecond)}/s)
                  </span>
                </div>
              )}
            </>
          )}

          {updateStatus.status === "downloaded" && (
            <>
              <strong>{t("update.downloaded", { version })}</strong>
              <span className="update-notification-hint">
                {t("update.downloadedHint")}
              </span>
            </>
          )}

          {updateStatus.status === "error" && (
            <>
              <strong>{t("update.error")}</strong>
              <span className="update-notification-hint update-error-text">
                {updateStatus.error || t("errors.unknown")}
              </span>
            </>
          )}

          {/* Release notes toggle */}
          {notesText &&
            (updateStatus.status === "available" ||
              updateStatus.status === "available-portable") && (
              <button
                className="update-details-toggle"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails
                  ? t("update.hideDetails")
                  : t("update.showDetails")}
              </button>
            )}

          {/* Release notes content */}
          {showDetails && notesText && (
            <div
              className="update-release-notes"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(notesText) }}
            />
          )}
        </div>

        {/* Actions */}
        <div className="update-notification-actions">
          {updateStatus.status === "available" && (
            <>
              <button
                className="update-btn update-btn-primary"
                onClick={handleDownload}
                disabled={isStartingDownload}
              >
                {isStartingDownload
                  ? t("update.pleaseWait")
                  : t("update.download")}
              </button>
              <button
                className="update-btn update-btn-secondary"
                onClick={handleDismiss}
                disabled={isStartingDownload}
              >
                {t("update.later")}
              </button>
            </>
          )}

          {updateStatus.status === "available-portable" && (
            <>
              <button
                className="update-btn update-btn-primary"
                onClick={handleOpenReleasePage}
              >
                {t("update.openDownloadPage")}
              </button>
              <button
                className="update-btn update-btn-secondary"
                onClick={handleDismiss}
              >
                {t("update.later")}
              </button>
            </>
          )}

          {updateStatus.status === "downloaded" && (
            <>
              <button
                className="update-btn update-btn-primary"
                onClick={handleInstall}
              >
                {t("update.installRestart")}
              </button>
              <button
                className="update-btn update-btn-secondary"
                onClick={handleDismiss}
              >
                {t("update.later")}
              </button>
            </>
          )}

          {updateStatus.status === "error" && (
            <>
              <button
                className="update-btn update-btn-secondary"
                onClick={handleCheckForUpdates}
              >
                {t("update.retry")}
              </button>
              <button
                className="update-btn update-btn-secondary"
                onClick={handleDismiss}
              >
                {t("update.dismiss")}
              </button>
            </>
          )}

          {updateStatus.status === "downloading" && (
            <span className="update-downloading-hint">
              {t("update.pleaseWait")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Escape HTML-significant characters so user content can be safely embedded.
 */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

/**
 * Apply inline markdown patterns to already HTML-escaped text.
 * Supports: `code`, **bold**, *italic*, [text](url), bare URLs.
 */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)]\(([^)\s]+)\)/g,
      (_m: string, text: string, url: string) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
    )
    .replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (_m: string, lead: string, url: string) =>
        `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
}

/**
 * Minimal Markdown -> HTML renderer for GitHub release notes.
 * Supports headings, unordered lists, paragraphs and inline formatting.
 * Input is HTML-escaped first to keep this safe for dangerouslySetInnerHTML.
 */
function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      out.push(
        `<h${level}>${renderInline(escapeHtml(heading[2] ?? ""))}</h${level}>`,
      );
      continue;
    }

    const li = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInline(escapeHtml(li[1] ?? ""))}</li>`);
      continue;
    }

    if (raw.trim() === "") {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${renderInline(escapeHtml(raw))}</p>`);
  }

  closeList();
  return out.join("\n");
}
