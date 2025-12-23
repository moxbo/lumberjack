/**
 * Settings Modal Component - Modern Design
 */
import { useI18n, type Locale } from "../../utils/i18n";
import logger from "../../utils/logger";
import type { SettingsForm, SettingsTab } from "../../hooks";
import { useFeatureFlags } from "../../hooks";
import { FeatureFlagsPanel } from "./FeatureFlagsPanel";
import type { JSX } from "preact";

// SVG Icons for tabs
const TabIcons: Record<SettingsTab, JSX.Element> = {
  tcp: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
  http: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  elastic: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
  logging: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  ),
  appearance: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  features: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
};

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
  const { features, loading } = useFeatureFlags();

  if (!open) return null;

  // Feature-Status prüfen
  // Ein Feature ist deaktiviert wenn: nicht loading UND enabled explizit false ist
  const tcpEnabled = loading || features["TCP_SERVER"]?.enabled !== false;
  const httpEnabled = loading || features["HTTP_POLLING"]?.enabled !== false;
  const elasticEnabled =
    loading || features["ELASTICSEARCH"]?.enabled !== false;
  const fileLoggingEnabled =
    loading || features["FILE_LOGGING"]?.enabled !== false;

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
        className="modal modal-settings modal-settings-modern"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-header">
          <h3>{t("settings.title")}</h3>
          <button
            className="settings-close-btn"
            onClick={handleClose}
            aria-label="Schließen"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Main Content with Sidebar */}
        <div className="settings-layout">
          {/* Sidebar Navigation */}
          <nav
            className="settings-sidebar"
            role="tablist"
            aria-label="Einstellungen Navigation"
          >
            {(
              [
                "tcp",
                "http",
                "elastic",
                "logging",
                "appearance",
                "features",
              ] as SettingsTab[]
            ).map((tabKey) => (
              <button
                key={tabKey}
                className={`settings-nav-item${tab === tabKey ? " active" : ""}`}
                role="tab"
                aria-selected={tab === tabKey}
                onClick={() => onTabChange(tabKey)}
              >
                <span className="settings-nav-icon">{TabIcons[tabKey]}</span>
                <span className="settings-nav-label">
                  {tabKey === "appearance"
                    ? t("settings.tabs.appearance")
                    : tabKey === "features"
                      ? t("settings.tabs.features")
                      : tabKey.toUpperCase()}
                </span>
              </button>
            ))}
          </nav>

          {/* Content Area */}
          <div className="settings-content">
            {/* TCP Tab */}
            {tab === "tcp" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>TCP Server</h4>
                  <p className="settings-panel-description">
                    Konfigurieren Sie den TCP-Server für eingehende
                    Log-Nachrichten.
                  </p>
                </div>
                {!tcpEnabled && (
                  <div className="feature-disabled-warning">
                    {t("featureFlags.disabledWarning")}
                  </div>
                )}
                <div className="settings-card">
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="tcp-port">
                      {t("settings.tcp.port")}
                    </label>
                    <p className="settings-field-hint">
                      Port auf dem der TCP-Server lauscht (1-65535)
                    </p>
                    <input
                      id="tcp-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={form.tcpPort}
                      disabled={!tcpEnabled}
                      className="settings-input"
                      onInput={(e) =>
                        onFormChange({
                          ...form,
                          tcpPort: Number(e.currentTarget.value || 0),
                        })
                      }
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        className="settings-checkbox"
                        checked={canTcpControlWindow}
                        disabled={!tcpEnabled}
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
                      <span className="settings-checkbox-text">
                        <span className="settings-checkbox-title">
                          {t("settings.tcp.windowControl")}
                        </span>
                        <span className="settings-checkbox-hint">
                          Erlaubt TCP-Clients, dieses Fenster zu steuern
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* HTTP Tab */}
            {tab === "http" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>HTTP Polling</h4>
                  <p className="settings-panel-description">
                    Konfigurieren Sie das HTTP-Polling für Log-Abfragen.
                  </p>
                </div>
                {!httpEnabled && (
                  <div className="feature-disabled-warning">
                    {t("featureFlags.disabledWarning")}
                  </div>
                )}
                <div className="settings-card">
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="http-url">
                      {t("settings.http.url")}
                    </label>
                    <p className="settings-field-hint">
                      URL des HTTP-Endpunkts für Log-Daten
                    </p>
                    <input
                      id="http-url"
                      type="text"
                      value={form.httpUrl}
                      disabled={!httpEnabled}
                      className="settings-input"
                      onInput={(e) =>
                        onFormChange({
                          ...form,
                          httpUrl: e.currentTarget.value,
                        })
                      }
                      placeholder="https://…/logs.json"
                      autoFocus
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="http-interval">
                      {t("settings.http.interval")}
                    </label>
                    <p className="settings-field-hint">
                      Abfrageintervall in Millisekunden
                    </p>
                    <input
                      id="http-interval"
                      type="number"
                      min="500"
                      step="500"
                      value={form.httpInterval}
                      disabled={!httpEnabled}
                      className="settings-input"
                      onInput={(e) =>
                        onFormChange({
                          ...form,
                          httpInterval: Number(e.currentTarget.value || 5000),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Elasticsearch Tab */}
            {tab === "elastic" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>Elasticsearch</h4>
                  <p className="settings-panel-description">
                    Verbindungseinstellungen für Elasticsearch-Abfragen.
                  </p>
                </div>
                {!elasticEnabled && (
                  <div className="feature-disabled-warning">
                    {t("featureFlags.disabledWarning")}
                  </div>
                )}
                <div className="settings-card">
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="es-url">
                      {t("settings.elastic.url")}
                    </label>
                    <p className="settings-field-hint">
                      URL des Elasticsearch-Clusters
                    </p>
                    <input
                      id="es-url"
                      type="text"
                      value={form.elasticUrl}
                      disabled={!elasticEnabled}
                      className="settings-input"
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

                  <div className="settings-field-group">
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="es-size">
                        {t("settings.elastic.size")}
                      </label>
                      <p className="settings-field-hint">
                        Anzahl Ergebnisse pro Abfrage
                      </p>
                      <input
                        id="es-size"
                        type="number"
                        min="1"
                        max="10000"
                        value={form.elasticSize}
                        disabled={!elasticEnabled}
                        className="settings-input"
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
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="es-parallel">
                        {t("settings.elastic.maxParallel")}
                      </label>
                      <p className="settings-field-hint">
                        Parallele Seitenabfragen
                      </p>
                      <input
                        id="es-parallel"
                        type="number"
                        min="1"
                        max="8"
                        value={form.elasticMaxParallel || 1}
                        disabled={!elasticEnabled}
                        className="settings-input"
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
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-field-group">
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="es-user">
                        {t("settings.elastic.user")}
                      </label>
                      <input
                        id="es-user"
                        type="text"
                        value={form.elasticUser}
                        disabled={!elasticEnabled}
                        className="settings-input"
                        onInput={(e) =>
                          onFormChange({
                            ...form,
                            elasticUser: e.currentTarget.value,
                          })
                        }
                        placeholder="user"
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="es-pass">
                        {t("settings.elastic.password")}
                      </label>
                      <div className="settings-input-group">
                        <input
                          id="es-pass"
                          type="password"
                          value={form.elasticPassNew}
                          disabled={!elasticEnabled}
                          className="settings-input"
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
                          className="settings-btn-secondary"
                          disabled={!elasticEnabled}
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
                      <p className="settings-field-hint">
                        {elasticHasPass && !form.elasticPassClear
                          ? t("settings.elastic.passwordCurrentSet")
                          : t("settings.elastic.passwordCurrentNotSet")}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Logging Tab */}
            {tab === "logging" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>Logging</h4>
                  <p className="settings-panel-description">
                    Konfigurieren Sie das Datei-Logging der Anwendung.
                  </p>
                </div>
                {!fileLoggingEnabled && (
                  <div className="feature-disabled-warning">
                    {t("featureFlags.disabledWarning")}
                  </div>
                )}
                <div className="settings-card">
                  <div className="settings-field">
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        className="settings-checkbox"
                        checked={form.logToFile}
                        disabled={!fileLoggingEnabled}
                        onChange={(e) =>
                          onFormChange({
                            ...form,
                            logToFile: e.currentTarget.checked,
                          })
                        }
                      />
                      <span className="settings-checkbox-text">
                        <span className="settings-checkbox-title">
                          {t("settings.logging.toFile")}
                        </span>
                        <span className="settings-checkbox-hint">
                          Speichert Log-Ausgaben in einer Datei
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label" htmlFor="log-file">
                      {t("settings.logging.file")}
                    </label>
                    <div className="settings-input-group">
                      <input
                        id="log-file"
                        type="text"
                        value={form.logFilePath}
                        className="settings-input"
                        onInput={(e) =>
                          onFormChange({
                            ...form,
                            logFilePath: e.currentTarget.value,
                          })
                        }
                        placeholder={t("settings.logging.filePlaceholder")}
                        disabled={!fileLoggingEnabled || !form.logToFile}
                      />
                      <button
                        className="settings-btn-secondary"
                        onClick={async () => {
                          try {
                            const p = await window.api.chooseLogFile();
                            if (p) onFormChange({ ...form, logFilePath: p });
                          } catch (e) {
                            logger.warn("chooseLogFile failed:", e as any);
                          }
                        }}
                        disabled={!fileLoggingEnabled || !form.logToFile}
                      >
                        {t("settings.logging.choose")}
                      </button>
                    </div>
                  </div>

                  <div className="settings-field-group">
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="log-max-size">
                        {t("settings.logging.maxSize")}
                      </label>
                      <p className="settings-field-hint">
                        Maximale Dateigröße in MB
                      </p>
                      <input
                        id="log-max-size"
                        type="number"
                        min="1"
                        step="1"
                        value={form.logMaxMB}
                        className="settings-input"
                        onInput={(e) =>
                          onFormChange({
                            ...form,
                            logMaxMB: Number(e.currentTarget.value || 5),
                          })
                        }
                        disabled={!fileLoggingEnabled || !form.logToFile}
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="log-backups">
                        {t("settings.logging.maxBackups")}
                      </label>
                      <p className="settings-field-hint">
                        Anzahl Backup-Dateien
                      </p>
                      <input
                        id="log-backups"
                        type="number"
                        min="0"
                        step="1"
                        value={form.logMaxBackups}
                        className="settings-input"
                        onInput={(e) =>
                          onFormChange({
                            ...form,
                            logMaxBackups: Number(e.currentTarget.value || 0),
                          })
                        }
                        disabled={!fileLoggingEnabled || !form.logToFile}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {tab === "appearance" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>{t("settings.tabs.appearance")}</h4>
                  <p className="settings-panel-description">
                    Passen Sie das Erscheinungsbild der Anwendung an.
                  </p>
                </div>
                <div className="settings-card">
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="theme">
                      {t("settings.appearance.theme")}
                    </label>
                    <p className="settings-field-hint">
                      Wählen Sie ein Farbschema
                    </p>
                    <div className="settings-theme-selector">
                      {[
                        { value: "system", label: "System", icon: "💻" },
                        { value: "light", label: "Hell", icon: "☀️" },
                        { value: "dark", label: "Dunkel", icon: "🌙" },
                      ].map((theme) => (
                        <button
                          key={theme.value}
                          type="button"
                          className={`settings-theme-btn${form.themeMode === theme.value ? " active" : ""}`}
                          onClick={() => {
                            onFormChange({ ...form, themeMode: theme.value });
                            applyThemeMode(
                              ["light", "dark"].includes(theme.value)
                                ? theme.value
                                : "system",
                            );
                          }}
                        >
                          <span className="settings-theme-icon">
                            {theme.icon}
                          </span>
                          <span className="settings-theme-label">
                            {theme.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-field">
                    <label className="settings-label" htmlFor="language">
                      {t("settings.language.label")}
                    </label>
                    <p className="settings-field-hint">
                      Sprache der Benutzeroberfläche
                    </p>
                    <select
                      id="language"
                      className="settings-select"
                      value={locale}
                      onChange={(e) =>
                        onLocaleChange(e.currentTarget.value as Locale)
                      }
                    >
                      <option value="de">
                        {t("settings.language.german")}
                      </option>
                      <option value="en">
                        {t("settings.language.english")}
                      </option>
                    </select>
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-field">
                    <label className="settings-label">
                      {t("settings.appearance.accent")}
                    </label>
                    <p className="settings-field-hint settings-accent-info">
                      {t("settings.appearance.accentInfo")}
                    </p>
                  </div>

                  <div className="settings-divider" />

                  {/* Auto-Update Pre-Release Toggle */}
                  <div className="settings-field">
                    <div className="settings-toggle-row">
                      <div className="settings-toggle-info">
                        <label
                          className="settings-label"
                          htmlFor="allowPrerelease"
                        >
                          {t("settings.updates.betaChannel")}
                        </label>
                        <p className="settings-field-hint">
                          {t("settings.updates.betaChannelHint")}
                        </p>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          id="allowPrerelease"
                          checked={form.allowPrerelease}
                          onChange={(e) =>
                            onFormChange({
                              ...form,
                              allowPrerelease: e.currentTarget.checked,
                            })
                          }
                        />
                        <span className="settings-toggle-slider" />
                      </label>
                    </div>
                  </div>

                  <div className="settings-divider" />

                  {/* Heap Size Setting */}
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="heapSizeMB">
                      {t("settings.performance.heapSize")}
                    </label>
                    <p className="settings-field-hint">
                      {t("settings.performance.heapSizeHint")}
                    </p>
                    <select
                      id="heapSizeMB"
                      className="settings-select"
                      value={form.heapSizeMB || 2048}
                      onChange={(e) =>
                        onFormChange({
                          ...form,
                          heapSizeMB: parseInt(e.currentTarget.value, 10),
                        })
                      }
                    >
                      <option value={512}>512 MB</option>
                      <option value={1024}>1 GB</option>
                      <option value={2048}>
                        2 GB ({t("settings.performance.default")})
                      </option>
                      <option value={4096}>4 GB</option>
                      <option value={8192}>8 GB</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Features Tab */}
            {tab === "features" && (
              <div className="settings-panel" role="tabpanel">
                <div className="settings-panel-header">
                  <h4>{t("settings.tabs.features")}</h4>
                  <p className="settings-panel-description">
                    Aktivieren oder deaktivieren Sie einzelne Funktionen.
                  </p>
                </div>
                <div className="settings-card">
                  <FeatureFlagsPanel />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="settings-footer">
          <button
            className="settings-btn settings-btn-secondary"
            onClick={handleClose}
          >
            {t("settings.cancel")}
          </button>
          <button
            className="settings-btn settings-btn-primary"
            onClick={handleSave}
          >
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
