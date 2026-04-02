/**
 * StatusSection Component
 *
 * Shows busy spinner, TCP status, HTTP status, and next-poll countdown
 * in the toolbar.
 */
import type { JSX } from "preact/jsx-runtime";

export interface StatusSectionProps {
  busy: boolean;
  tcpStatus: string;
  httpStatus: string;
  nextPollIn: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function StatusSection({
  busy,
  tcpStatus,
  httpStatus,
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
    <div className="section">
      {busy && (
        <span className="busy">
          <span className="spinner"></span>
          {t("toolbar.busy")}
        </span>
      )}
      {/* TCP Status - show when active */}
      {isTcpActive && (
        <span id="tcpStatus" className="status status-active">
          🟢 {tcpStatus}
        </span>
      )}
      {/* HTTP Status - show when active */}
      {isHttpActive && (
        <span
          id="httpStatus"
          className={`status ${isHttpError ? "status-error" : "status-active"}`}
        >
          {isHttpError ? "🔴" : "🟢"} {httpStatus}
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
