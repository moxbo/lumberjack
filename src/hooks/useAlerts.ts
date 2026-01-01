/**
 * Hook for managing alerts/dialogs
 */
import { useCallback, useState } from "preact/hooks";
import { useI18n } from "../utils/i18n";

export type AlertType = "info" | "warning" | "error";

interface AlertState {
  open: boolean;
  title?: string;
  message: string;
  type?: AlertType;
}

export function useAlerts() {
  const { t } = useI18n();
  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
  });

  // General alert helper
  const showAlert = useCallback(
    (message: string, options?: { title?: string; type?: AlertType }) => {
      setAlertState({
        open: true,
        message,
        title: options?.title,
        type: options?.type || "error",
      });
    },
    [],
  );

  // Close alert
  const closeAlert = useCallback(() => {
    setAlertState((prev) => ({ ...prev, open: false }));
  }, []);

  // Helper to show feature-disabled alert
  const showFeatureDisabledAlert = useCallback(
    (featureName: string, reason?: string) => {
      const featureLabel = t(`featureFlags.features.${featureName}`);
      const message = t("featureFlags.alertMessage", { feature: featureLabel });
      setAlertState({
        open: true,
        title: t("featureFlags.alertTitle"),
        message: reason
          ? `${message}\n\n${t("featureFlags.reason")}: ${reason}`
          : message,
        type: "warning",
      });
    },
    [t],
  );

  // Helper to check if error is from disabled feature
  const handleFeatureError = useCallback(
    (error: string | undefined): boolean => {
      if (!error) return false;

      const featurePatterns: { pattern: RegExp; feature: string }[] = [
        { pattern: /TCP.*deaktiviert|TCP.*disabled/i, feature: "TCP_SERVER" },
        {
          pattern: /HTTP.*deaktiviert|HTTP.*disabled/i,
          feature: "HTTP_POLLING",
        },
        {
          pattern: /Elasticsearch.*deaktiviert|Elasticsearch.*disabled/i,
          feature: "ELASTICSEARCH",
        },
      ];

      for (const { pattern, feature } of featurePatterns) {
        if (pattern.test(error)) {
          const reasonMatch = error.match(/:\s*(.+)$/);
          const reason = reasonMatch?.[1];
          showFeatureDisabledAlert(feature, reason);
          return true;
        }
      }
      return false;
    },
    [showFeatureDisabledAlert],
  );

  return {
    alertState,
    showAlert,
    closeAlert,
    showFeatureDisabledAlert,
    handleFeatureError,
  };
}
