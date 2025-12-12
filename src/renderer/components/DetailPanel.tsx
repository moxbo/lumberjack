/**
 * Detail Panel Component - Zeigt Details zum ausgewählten Log-Eintrag
 */
import { Fragment } from "preact";
import { useI18n } from "../../utils/i18n";
import { highlightAll } from "../../utils/highlight";
import { levelClass, fmtTimestamp, computeTint, fmt } from "../../utils/format";

interface DetailPanelProps {
  selectedEntry: any | null;
  mdcPairs: Array<[string, string]>;
  search: string;
  onAddMdcToFilter: (key: string, value: string) => void;
}

export function DetailPanel({
  selectedEntry,
  mdcPairs,
  search,
  onAddMdcToFilter,
}: DetailPanelProps) {
  const { t } = useI18n();

  return (
    <div
      className="details"
      data-tinted={
        selectedEntry && (selectedEntry._mark || selectedEntry.color)
          ? "1"
          : "0"
      }
      style={{
        ["--details-tint" as any]: computeTint(
          (selectedEntry && selectedEntry._mark) || selectedEntry?.color,
          0.22,
        ),
      }}
    >
      {!selectedEntry && (
        <div className="details-empty">
          <div className="details-empty-icon">👆</div>
          <div className="details-empty-title">{t("details.noSelection")}</div>
          <div className="details-empty-hint">{t("details.emptyHint")}</div>
        </div>
      )}

      {selectedEntry && (
        <Fragment>
          <div className="meta-grid">
            <div>
              <div className="kv">
                <span>{t("details.time")}</span>
                <div>{fmtTimestamp(selectedEntry.timestamp)}</div>
              </div>
              <div className="kv">
                <span>{t("details.logger")}</span>
                <div>{fmt(selectedEntry.logger)}</div>
              </div>
            </div>
            <div>
              <div className="kv">
                <span>{t("details.level")}</span>
                <div>
                  <span className={levelClass(selectedEntry.level)}>
                    {fmt(selectedEntry.level)}
                  </span>
                </div>
              </div>
              <div className="kv">
                <span>{t("details.thread")}</span>
                <div>{fmt(selectedEntry.thread)}</div>
              </div>
            </div>
          </div>

          <div className="section-sep" />

          <div className="kv full">
            <span>{t("details.message")}</span>
            <pre
              id="dMessage"
              dangerouslySetInnerHTML={{
                __html: highlightAll(selectedEntry.message || "", search),
              }}
            />
          </div>

          {(selectedEntry.stack_trace || selectedEntry.stackTrace) && (
            <div className="kv full">
              <span>{t("details.stacktrace")}</span>
              <pre className="stack-trace">
                {String(
                  selectedEntry.stack_trace || selectedEntry.stackTrace || "",
                )}
              </pre>
            </div>
          )}

          {mdcPairs.length > 0 && (
            <Fragment>
              <div className="section-sep" />
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}
              >
                {t("details.diagnosticContext")}
              </div>
              <div className="mdc-grid">
                {mdcPairs.map(([k, v]) => (
                  <Fragment key={k + "=" + v}>
                    <div className="mdc-key">{k}</div>
                    <div className="mdc-val">
                      <code>{v}</code>
                    </div>
                    <div
                      className="mdc-act"
                      style={{
                        display: "flex",
                        gap: "6px",
                        justifyContent: "end",
                      }}
                    >
                      <button
                        onClick={() => onAddMdcToFilter(k, v)}
                        title={t("details.addToFilter")}
                      >
                        +
                      </button>
                    </div>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          )}
        </Fragment>
      )}
    </div>
  );
}
