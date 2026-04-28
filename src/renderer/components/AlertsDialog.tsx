import { useState } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
import type { AlertRule, AlertSeverity } from "../../services/AlertEvaluator";

interface Props {
  open: boolean;
  rules: AlertRule[];
  onClose: () => void;
  onAdd: (partial: Partial<AlertRule>) => AlertRule;
  onUpdate: (id: string, patch: Partial<AlertRule>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

const LEVELS = ["", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
const SEVERITIES: AlertSeverity[] = ["info", "warning", "critical"];

export function AlertsDialog(props: Props): JSX.Element | null {
  const [editingId, setEditingId] = useState<string | null>(null);
  if (!props.open) return null;
  const editing = props.rules.find((r) => r.id === editingId) ?? null;
  const t = props.t;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="modal alerts-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("alerts.title")}
      >
        <div className="alerts-header">
          <h3>{t("alerts.title")}</h3>
          <p className="alerts-description">{t("alerts.description")}</p>
        </div>
        <div className="alerts-toolbar">
          <button
            type="button"
            onClick={() => {
              const r = props.onAdd({});
              setEditingId(r.id);
            }}
          >
            + {t("alerts.add")}
          </button>
        </div>
        <div className="alerts-content">
          <ul className="alerts-list">
            {props.rules.length === 0 && (
              <li className="alerts-empty">{t("alerts.empty")}</li>
            )}
            {props.rules.map((r) => (
              <li
                key={r.id}
                className={
                  "alerts-item " +
                  (r.enabled ? "enabled" : "disabled") +
                  " severity-" +
                  r.severity
                }
              >
                <label className="alerts-item-toggle">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => props.onToggle(r.id)}
                    aria-label={t("alerts.toggle")}
                  />
                </label>
                <button
                  type="button"
                  className="alerts-item-name"
                  onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                  title={t("alerts.edit")}
                >
                  {r.name}
                </button>
                <span className="alerts-item-summary">
                  {r.level || t("alerts.anyLevel")}
                  {r.loggerSubstring ? " | " + r.loggerSubstring : ""}
                  {r.messageSubstring ? ' | "' + r.messageSubstring + '"' : ""}
                </span>
                <button
                  type="button"
                  className="alerts-item-remove"
                  onClick={() => props.onRemove(r.id)}
                  title={t("alerts.remove")}
                  aria-label={t("alerts.remove")}
                >
                  x
                </button>
              </li>
            ))}
          </ul>

          {editing && (
            <div className="alerts-editor" role="group">
              <h4>{t("alerts.edit")}</h4>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldName")}</label>
                <input
                  type="text"
                  value={editing.name}
                  onInput={(e) =>
                    props.onUpdate(editing.id, {
                      name: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldLevel")}</label>
                <select
                  value={editing.level || ""}
                  onChange={(e) =>
                    props.onUpdate(editing.id, {
                      level: (e.target as HTMLSelectElement).value || undefined,
                    })
                  }
                >
                  {LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl || t("alerts.anyLevel")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldLogger")}</label>
                <input
                  type="text"
                  placeholder="com.example"
                  value={editing.loggerSubstring || ""}
                  onInput={(e) =>
                    props.onUpdate(editing.id, {
                      loggerSubstring: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldMessage")}</label>
                <input
                  type="text"
                  placeholder="OutOfMemory"
                  value={editing.messageSubstring || ""}
                  onInput={(e) =>
                    props.onUpdate(editing.id, {
                      messageSubstring: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldSeverity")}</label>
                <select
                  value={editing.severity}
                  onChange={(e) =>
                    props.onUpdate(editing.id, {
                      severity: (e.target as HTMLSelectElement)
                        .value as AlertSeverity,
                    })
                  }
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {t("alerts.severity." + s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="alerts-form-row">
                <label>{t("alerts.fieldCooldown")}</label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={editing.cooldownMs ?? 30000}
                  onInput={(e) =>
                    props.onUpdate(editing.id, {
                      cooldownMs: Number(
                        (e.target as HTMLInputElement).value || 0,
                      ),
                    })
                  }
                />
                <small>{t("alerts.cooldownHint")}</small>
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
