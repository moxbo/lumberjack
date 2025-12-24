/**
 * UpdateNotification Component
 * Displays a notification when a new app update is available
 * Allows the user to download, install, or dismiss the update
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import type { VNode } from "preact";
import { useI18n } from "../../utils/i18n";
import logger from "../../utils/logger";

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
    | "error";
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export function UpdateNotification(): VNode | null {
  const { t } = useI18n();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isStartingDownload, setIsStartingDownload] = useState(false);

  // Listen for update status changes from main process
  useEffect(() => {
    if (!window.api?.onAutoUpdaterStatus) {
      return;
    }

    const unsubscribe = window.api.onAutoUpdaterStatus(
      (status: UpdateStatus) => {
        logger.info("[UpdateNotification] Received status:", status);
        setUpdateStatus(status);

        // Reset isStartingDownload when download actually starts or on error
        if (status.status === "downloading" || status.status === "error") {
          setIsStartingDownload(false);
        }

        // Reset dismissed state when a new update becomes available
        if (status.status === "available") {
          setDismissed(false);
          setIsStartingDownload(false);
        }
      },
    );

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      setIsStartingDownload(true);
      logger.info("[UpdateNotification] Starting download...");
      await window.api?.autoUpdaterDownload?.();
    } catch (error) {
      logger.error("[UpdateNotification] Download failed:", error);
      setIsStartingDownload(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      logger.info("[UpdateNotification] Installing update...");
      await window.api?.autoUpdaterInstall?.();
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
      await window.api?.autoUpdaterCheck?.();
    } catch (error) {
      logger.error("[UpdateNotification] Update check failed:", error);
    }
  }, []);

  // Don't show if dismissed or no relevant status
  if (dismissed || !updateStatus) {
    return null;
  }

  // Only show for these statuses
  const showableStatuses = ["available", "downloading", "downloaded", "error"];
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
          {notesText && updateStatus.status === "available" && (
            <button
              className="update-details-toggle"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? t("update.hideDetails") : t("update.showDetails")}
            </button>
          )}

          {/* Release notes content */}
          {showDetails && notesText && (
            <div className="update-release-notes">
              <pre>{notesText}</pre>
            </div>
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
