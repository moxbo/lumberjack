/**
 * useFeatureFlags Hook
 * Preact hook for accessing and managing feature flags from the renderer
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import type { FeatureFlagsResult } from "../types/ipc";

export type FeatureName =
  | "TCP_SERVER"
  | "HTTP_POLLING"
  | "ELASTICSEARCH"
  | "FILE_LOGGING"
  | "HEALTH_MONITORING"
  | "ADAPTIVE_BATCHING"
  | "ASYNC_FILE_WRITER";

interface UseFeatureFlagsReturn {
  /** All features with their status */
  features: FeatureFlagsResult["features"];
  /** Statistics about enabled/disabled features */
  stats: FeatureFlagsResult["stats"];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Check if a specific feature is enabled */
  isEnabled: (feature: FeatureName) => boolean;
  /** Disable a feature with optional reason */
  disable: (feature: FeatureName, reason?: string) => Promise<void>;
  /** Enable a feature */
  enable: (feature: FeatureName) => Promise<void>;
  /** Reset all features to enabled */
  resetAll: () => Promise<void>;
  /** Refresh feature flags from main process */
  refresh: () => Promise<void>;
}

/**
 * Hook to manage feature flags
 * @returns Feature flags state and control methods
 */
export function useFeatureFlags(): UseFeatureFlagsReturn {
  const [features, setFeatures] = useState<FeatureFlagsResult["features"]>({});
  const [stats, setStats] = useState<FeatureFlagsResult["stats"]>({
    total: 0,
    enabled: 0,
    disabled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.api.featureFlagsGetAll();
      setFeatures(result.features);
      setStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isEnabled = useCallback(
    (feature: FeatureName): boolean => {
      return features[feature]?.enabled ?? true;
    },
    [features],
  );

  const disable = useCallback(
    async (feature: FeatureName, reason?: string): Promise<void> => {
      try {
        await window.api.featureFlagsDisable(feature, reason);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const enable = useCallback(
    async (feature: FeatureName): Promise<void> => {
      try {
        await window.api.featureFlagsEnable(feature);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const resetAll = useCallback(async (): Promise<void> => {
    try {
      await window.api.featureFlagsResetAll();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  return {
    features,
    stats,
    loading,
    error,
    isEnabled,
    disable,
    enable,
    resetAll,
    refresh,
  };
}
