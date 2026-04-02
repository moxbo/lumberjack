/**
 * ElasticStatusBar Component
 * Shows DC-filter status, Elasticsearch loading progress, load-more button, and loaded count
 */
import { DiagnosticContextFilter } from "../../store/dcFilter";
import { TimeFilter } from "../../store/timeFilter";

interface ElasticStatusBarProps {
  esBusy: boolean;
  esHasMore: boolean;
  esLoaded: number;
  esTarget: number;
  esPct: number;
  esTotal: number | null;
  esPitSessionId: string | null;
  esElasticCountAll: number;
  onLoadMore: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function ElasticStatusBar({
  esBusy,
  esHasMore,
  esLoaded,
  esTarget,
  esPct,
  esTotal,
  esPitSessionId,
  esElasticCountAll,
  onLoadMore,
  t,
}: ElasticStatusBarProps) {
  // DC-Filter status
  const dcEntries = DiagnosticContextFilter.getDcEntries();
  const dcTotal = dcEntries.length;
  const dcActive = dcEntries.filter((e) => e.active).length;
  const dcEnabled = DiagnosticContextFilter.isEnabled() && dcActive > 0;

  // Time filter / ES status
  let showEsActive = false;
  try {
    const s = TimeFilter.getState();
    showEsActive = !!(
      s &&
      s.enabled &&
      (esBusy || esElasticCountAll > 0 || esPitSessionId)
    );
  } catch {
    // ignore
  }

  return (
    <div className="section">
      {dcTotal > 0 && (
        <span
          className="status"
          title={
            dcEnabled
              ? t("toolbar.dcFilterActive", { count: String(dcActive) })
              : t("toolbar.dcFilterInactive", { count: String(dcTotal) })
          }
        >
          {dcEnabled
            ? t("toolbar.dcFilterActive", { count: String(dcActive) })
            : t("toolbar.dcFilterInactive", { count: String(dcTotal) })}
        </span>
      )}
      {showEsActive && (
        <span className="status" title={t("toolbar.elasticActive")}>
          {t("toolbar.elasticActive")}
        </span>
      )}
      {esBusy && (
        <span className="status" title={t("toolbar.elasticLoadProgress")}>
          {t("toolbar.elasticLoading", {
            loaded: String(esLoaded),
            target: String(esTarget),
            percent: String(Math.max(0, Math.min(100, esPct))),
          })}
        </span>
      )}
      {!esBusy && esHasMore && (
        <button
          style={{ marginLeft: "8px" }}
          title={t("toolbar.elasticLoadMoreTooltip")}
          onClick={onLoadMore}
        >
          {t("toolbar.elasticLoadMore")}{" "}
          {esTotal != null && esTotal > esLoaded
            ? `(${esTotal - esLoaded})`
            : ""}
        </button>
      )}
      {esTotal != null && (
        <span
          className="status"
          title={
            t("toolbar.elasticLoadedTooltip", {
              loaded: String(esLoaded),
              total: String(esTotal),
            }) + (esHasMore ? t("toolbar.elasticMoreAvailable") : "")
          }
        >
          {t("toolbar.elasticLoaded", {
            loaded: String(esLoaded),
            total: String(esTotal),
          })}
        </span>
      )}
    </div>
  );
}
