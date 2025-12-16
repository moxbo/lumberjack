/**
 * Settings Modal Component
 */
import { useI18n, type Locale } from "../../utils/i18n";
import logger from "../../utils/logger";
import type { SettingsForm, SettingsTab } from "../../hooks";
import { FeatureFlagsPanel } from "./FeatureFlagsPanel";

interface SettingsModalProps {
  open: boolean;
  tab: SettingsTab;
  form: SettingsForm;
  elasticHasPass: boolean;
  canTcpControlWindow: boolean;
  locale: string;
  onTabChange: (tab: SettingsTab) => void;
  onFormChange: (form: SettingsForm) => void;
  onCanTcpControlWindowChange: (value: boolean) => void;
  onLocaleChange: (locale: Locale) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  applyThemeMode: (mode: string | null | undefined) => void;
}

export function SettingsModal({
  open,
  tab,
  form,
  elasticHasPass,
  canTcpControlWindow,
  locale,
  onTabChange,
  onFormChange,
  onCanTcpControlWindowChange,
  onLocaleChange,
  onSave,
  onClose,
  applyThemeMode,
}: SettingsModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  const handleClose = () => {
    applyThemeMode(form.themeMode);
    onClose();
  };

  const handleSave = async () => {
    await onSave();
    // Modal closes automatically on success via the hook
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal modal-settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t("settings.title")}</h3>
        <div className="tabs">
          <div
            className="tablist"
            role="tablist"
            aria-label="Einstellungen Tabs"
          >
            <button
              className={`tab${tab === "tcp" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "tcp"}
              onClick={() => onTabChange("tcp")}
            >
              TCP
            </button>
            <button
              className={`tab${tab === "http" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "http"}
              onClick={() => onTabChange("http")}
            >
              HTTP
            </button>
            <button
              className={`tab${tab === "elastic" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "elastic"}
              onClick={() => onTabChange("elastic")}
            >
              Elasticsearch
            </button>
            <button
              className={`tab${tab === "logging" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "logging"}
              onClick={() => onTabChange("logging")}
            >
              Logging
            </button>
            <button
              className={`tab${tab === "appearance" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "appearance"}
              onClick={() => onTabChange("appearance")}
            >
              {t("settings.tabs.appearance")}
            </button>
            <button
              className={`tab${tab === "features" ? " active" : ""}`}
              role="tab"
              aria-selected={tab === "features"}
              onClick={() => onTabChange("features")}
            >
              {t("settings.tabs.features")}
            </button>
          </div>

          <div className="tabpanels">
            {/* TCP Tab */}
            {tab === "tcp" && (
              <div className="tabpanel" role="tabpanel">
                <div className="kv">
                  <span>{t("settings.tcp.port")}</span>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={form.tcpPort}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        tcpPort: Number(e.currentTarget.value || 0),
                      })
                    }
                  />
                </div>
                <div className="kv">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <input
                      type="checkbox"
                      className="native-checkbox"
                      checked={canTcpControlWindow}
                      onChange={async (e) => {
                        const v = e.currentTarget.checked;
                        onCanTcpControlWindowChange(v);
                        try {
                          await window.api?.windowPermsSet?.({
                            canTcpControl: v,
                          });
                        } catch (err) {
                          logger.warn("windowPermsSet failed:", err as any);
                        }
                      }}
                    />
                    <span>{t("settings.tcp.windowControl")}</span>
                  </label>
                </div>
              </div>
            )}

            {/* HTTP Tab */}
            {tab === "http" && (
              <div className="tabpanel" role="tabpanel">
                <div className="kv">
                  <span>{t("settings.http.url")}</span>
                  <input
                    type="text"
                    value={form.httpUrl}
                    onInput={(e) =>
                      onFormChange({ ...form, httpUrl: e.currentTarget.value })
                    }
                    placeholder="https://…/logs.json"
                    autoFocus
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.http.interval")}</span>
                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={form.httpInterval}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        httpInterval: Number(e.currentTarget.value || 5000),
                      })
                    }
                  />
                </div>
              </div>
            )}

            {/* Elasticsearch Tab */}
            {tab === "elastic" && (
              <div className="tabpanel" role="tabpanel">
                <div className="kv">
                  <span>{t("settings.elastic.url")}</span>
                  <input
                    type="text"
                    value={form.elasticUrl}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        elasticUrl: e.currentTarget.value,
                      })
                    }
                    placeholder="https://es:9200"
                    autoFocus
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.elastic.size")}</span>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={form.elasticSize}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        elasticSize: Math.max(
                          1,
                          Number(e.currentTarget.value || 1000),
                        ),
                      })
                    }
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.elastic.maxParallel")}</span>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={form.elasticMaxParallel || 1}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        elasticMaxParallel: Math.max(
                          1,
                          Number(e.currentTarget.value || 1),
                        ),
                      })
                    }
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.elastic.user")}</span>
                  <input
                    type="text"
                    value={form.elasticUser}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        elasticUser: e.currentTarget.value,
                      })
                    }
                    placeholder="user"
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.elastic.password")}</span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "6px",
                    }}
                  >
                    <input
                      type="password"
                      value={form.elasticPassNew}
                      onInput={(e) =>
                        onFormChange({
                          ...form,
                          elasticPassNew: e.currentTarget.value,
                          elasticPassClear: false,
                        })
                      }
                      placeholder={
                        elasticHasPass
                          ? t("settings.elastic.passwordSet")
                          : t("settings.elastic.passwordPlaceholder")
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onFormChange({
                          ...form,
                          elasticPassNew: "",
                          elasticPassClear: true,
                        })
                      }
                      title={t("settings.elastic.passwordDelete")}
                    >
                      {t("settings.elastic.passwordDeleteButton")}
                    </button>
                  </div>
                  <small style={{ color: "#6b7280" }}>
                    {elasticHasPass && !form.elasticPassClear
                      ? t("settings.elastic.passwordCurrentSet")
                      : t("settings.elastic.passwordCurrentNotSet")}
                  </small>
                </div>
              </div>
            )}

            {/* Logging Tab */}
            {tab === "logging" && (
              <div className="tabpanel" role="tabpanel">
                <div className="kv">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <input
                      type="checkbox"
                      className="native-checkbox"
                      checked={form.logToFile}
                      onChange={(e) =>
                        onFormChange({
                          ...form,
                          logToFile: e.currentTarget.checked,
                        })
                      }
                    />
                    <span>{t("settings.logging.toFile")}</span>
                  </label>
                </div>
                <div className="kv">
                  <span>{t("settings.logging.file")}</span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "6px",
                    }}
                  >
                    <input
                      type="text"
                      value={form.logFilePath}
                      onInput={(e) =>
                        onFormChange({
                          ...form,
                          logFilePath: e.currentTarget.value,
                        })
                      }
                      placeholder={t("settings.logging.filePlaceholder")}
                      disabled={!form.logToFile}
                    />
                    <button
                      onClick={async () => {
                        try {
                          const p = await window.api.chooseLogFile();
                          if (p) onFormChange({ ...form, logFilePath: p });
                        } catch (e) {
                          logger.warn("chooseLogFile failed:", e as any);
                        }
                      }}
                      disabled={!form.logToFile}
                    >
                      {t("settings.logging.choose")}
                    </button>
                  </div>
                </div>
                <div className="kv">
                  <span>{t("settings.logging.maxSize")}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.logMaxMB}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        logMaxMB: Number(e.currentTarget.value || 5),
                      })
                    }
                    disabled={!form.logToFile}
                  />
                </div>
                <div className="kv">
                  <span>{t("settings.logging.maxBackups")}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.logMaxBackups}
                    onInput={(e) =>
                      onFormChange({
                        ...form,
                        logMaxBackups: Number(e.currentTarget.value || 0),
                      })
                    }
                    disabled={!form.logToFile}
                  />
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {tab === "appearance" && (
              <div className="tabpanel" role="tabpanel">
                <div className="kv">
                  <span>{t("settings.appearance.theme")}</span>
                  <select
                    value={form.themeMode}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      onFormChange({ ...form, themeMode: v });
                      applyThemeMode(
                        ["light", "dark"].includes(v) ? v : "system",
                      );
                    }}
                  >
                    <option value="system">System</option>
                    <option value="light">Hell</option>
                    <option value="dark">Dunkel</option>
                  </select>
                </div>
                <div className="kv">
                  <span>{t("settings.language.label")}</span>
                  <select
                    value={locale}
                    onChange={(e) =>
                      onLocaleChange(e.currentTarget.value as Locale)
                    }
                  >
                    <option value="de">{t("settings.language.german")}</option>
                    <option value="en">{t("settings.language.english")}</option>
                  </select>
                </div>
                <div className="kv">
                  <span>{t("settings.appearance.accent")}</span>
                  <div>
                    <small style={{ color: "#6b7280" }}>
                      {t("settings.appearance.accentInfo")}
                    </small>
                  </div>
                </div>
              </div>
            )}

            {/* Features Tab */}
            {tab === "features" && (
              <div className="tabpanel" role="tabpanel">
                <FeatureFlagsPanel />
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={handleClose}>{t("settings.cancel")}</button>
          <button onClick={handleSave}>{t("settings.save")}</button>
        </div>
      </div>
    </div>
  );
}
