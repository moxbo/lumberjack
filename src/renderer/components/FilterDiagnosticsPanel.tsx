import { useLayoutEffect, useState } from "preact/hooks";
import { useI18n } from "../../utils/i18n";
import {
  FILTER_SAMPLE_LIMIT,
  type FilterDiagnostics,
} from "../filterDiagnostics";

const metrics = ["firstVisibleMs", "finalListMs", "longestTaskMs"] as const;

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
}

export function FilterDiagnosticsPanel({
  enabled,
  onChange,
  recorder,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  recorder: FilterDiagnostics | null;
}) {
  const { t, locale } = useI18n();
  const [, refresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  useLayoutEffect(
    () => recorder?.subscribe(() => refresh((n) => n + 1)),
    [recorder],
  );
  const samples = recorder?.report().samples ?? [];
  const last = samples.at(-1);
  const format = (ms: number | null) =>
    ms === null
      ? "—"
      : `${ms.toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;

  async function save() {
    if (!recorder || !last || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const result = await window.api.exportView(
        JSON.stringify(recorder.report(), null, 2),
        {
          format: "json",
          purpose: "filter-diagnostics",
        },
      );
      if (result.ok) setStatus(t("settings.diagnostics.saved"));
      else if (result.error !== "canceled")
        throw new Error(result.error || t("status.errorUnknown"));
    } catch (error) {
      setStatus(
        t("errors.saveFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-field">
        <label className="settings-label" htmlFor="filterDiagnosticsEnabled">
          <input
            id="filterDiagnosticsEnabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.currentTarget.checked)}
            aria-describedby="filterDiagnosticsHint"
          />{" "}
          {t("settings.diagnostics.enable")}
        </label>
        <p className="settings-field-hint" id="filterDiagnosticsHint">
          {t("settings.diagnostics.hint", { limit: FILTER_SAMPLE_LIMIT })}
        </p>
        {recorder && (
          <>
            {last ? (
              <table className="filter-diagnostics-table">
                <caption>
                  {t("settings.diagnostics.samples", {
                    count: samples.length,
                    input: last.inputCount,
                    result: last.resultCount,
                  })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("settings.diagnostics.metric")}</th>
                    <th scope="col">{t("settings.diagnostics.latest")}</th>
                    <th scope="col">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((key) => (
                    <tr key={key}>
                      <th scope="row">{t(`settings.diagnostics.${key}`)}</th>
                      <td>{format(last[key])}</td>
                      <td>
                        {format(
                          median(
                            samples.flatMap((sample) =>
                              sample[key] === null ? [] : [sample[key]],
                            ),
                          ),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>{t("settings.diagnostics.empty")}</p>
            )}
            <p className="settings-field-hint">
              {t("settings.diagnostics.metricsHint")}
            </p>
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              disabled={!last || saving}
              onClick={save}
            >
              {t("settings.diagnostics.export")}
            </button>
            <span role="status">{status}</span>
          </>
        )}
      </div>
    </div>
  );
}
