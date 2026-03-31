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
  return (
    <div className="section">
      {busy && (
        <span className="busy">
          <span className="spinner"></span>
          {t("toolbar.busy")}
        </span>
      )}
      {/* TCP Status - nur anzeigen wenn aktiv */}
      {tcpStatus && !tcpStatus.includes("geschlossen") && (
        <span id="tcpStatus" className="status status-active">
          🟢 {tcpStatus}
        </span>
      )}
      {/* HTTP Status - nur anzeigen wenn aktiv */}
      {httpStatus && !httpStatus.includes("inaktiv") && (
        <span
          id="httpStatus"
          className={`status ${httpStatus.startsWith("Fehler:") ? "status-error" : "status-active"}`}
        >
          {httpStatus.startsWith("Fehler:") ? "🔴" : "🟢"} {httpStatus}
        </span>
      )}
      {nextPollIn && (
        <span className="status" title="Nächster Poll in">
          {nextPollIn}
        </span>
      )}
    </div>
  );
}
