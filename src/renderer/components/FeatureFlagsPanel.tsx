/**
 * FeatureFlagsPanel Component
 * UI component for viewing and managing feature flags in settings
 */

import { useFeatureFlags, type FeatureName } from "../../hooks";
import { useI18n } from "../../utils/i18n";

const FEATURE_LIST: FeatureName[] = [
  "TCP_SERVER",
  "HTTP_POLLING",
  "ELASTICSEARCH",
  "FILE_LOGGING",
  "HEALTH_MONITORING",
  "ADAPTIVE_BATCHING",
  "ASYNC_FILE_WRITER",
];

export function FeatureFlagsPanel() {
  const { features, stats, loading, error, enable, disable, resetAll } =
    useFeatureFlags();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="feature-flags-loading">{t("featureFlags.loading")}</div>
    );
  }

  if (error) {
    return (
      <div className="feature-flags-error">
        {t("featureFlags.error")}: {error}
      </div>
    );
  }

  const handleToggle = async (
    feature: FeatureName,
    currentlyEnabled: boolean,
  ) => {
    if (currentlyEnabled) {
      await disable(feature, t("featureFlags.manuallyDisabled"));
    } else {
      await enable(feature);
    }
  };

  return (
    <div className="feature-flags-panel">
      <div className="feature-flags-header">
        <h4>{t("featureFlags.title")}</h4>
        <div className="feature-flags-stats">
          <span className="stat enabled">
            {stats.enabled} {t("featureFlags.active")}
          </span>
          <span className="stat disabled">
            {stats.disabled} {t("featureFlags.disabled")}
          </span>
        </div>
      </div>

      <p className="feature-flags-description">
        {t("featureFlags.description")}
      </p>

      <div className="feature-flags-list">
        {FEATURE_LIST.map((feature) => {
          const featureData = features[feature];
          const isEnabled = featureData?.enabled ?? true;
          const reason = featureData?.reason;
          const description = t(`featureFlags.features.${feature}`);

          return (
            <div
              key={feature}
              className={`feature-flag-item ${isEnabled ? "enabled" : "disabled"}`}
            >
              <div className="feature-flag-info">
                <span className="feature-name">{feature}</span>
                <span className="feature-description">{description}</span>
                {reason && (
                  <span className="feature-reason">
                    {t("featureFlags.reason")}: {reason}
                  </span>
                )}
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => handleToggle(feature, isEnabled)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          );
        })}
      </div>

      {stats.disabled > 0 && (
        <button
          className="btn btn-secondary feature-flags-reset"
          onClick={resetAll}
        >
          {t("featureFlags.enableAll")}
        </button>
      )}
    </div>
  );
}
