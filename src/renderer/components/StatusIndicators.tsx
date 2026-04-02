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
  const isTcpActive =
    !!tcpStatus &&
    tcpStatus !== t("status.tcpStopped") &&
    tcpStatus !== t("status.tcpError");
  const errorPrefix = t("status.error").split("{{")[0] || "Error";
  const isHttpError = !!httpStatus && httpStatus.startsWith(errorPrefix);
  const isHttpActive =
    !!httpStatus && httpStatus !== t("status.httpPollStopped");

  return (
    <div className="section">
      {busy && (
        <span className="busy">
          <span className="spinner"></span>
          {t("toolbar.busy")}
        </span>
      )}
      {isTcpActive && (
        <span id="tcpStatus" className="status status-active">
          🟢 {tcpStatus}
        </span>
      )}
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
