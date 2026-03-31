/**
 * StatusIndicators Component
 * Shows busy spinner, TCP status, HTTP status, and poll countdown
 */

interface StatusIndicatorsProps {
  busy: boolean;
  tcpStatus: string;
  httpStatus: string;
  nextPollIn: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function StatusIndicators({
  busy,
  tcpStatus,
  httpStatus,
  nextPollIn,
  t,
}: StatusIndicatorsProps) {
  return (
    <div className="section">
      {busy && (
        <span className="busy">
          <span className="spinner"></span>
          {t("toolbar.busy")}
        </span>
      )}
      {tcpStatus && !tcpStatus.includes("geschlossen") && (
        <span id="tcpStatus" className="status status-active">
          🟢 {tcpStatus}
        </span>
      )}
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
