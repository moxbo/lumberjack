/**
 * FeatureFlags
 * Graceful degradation through feature toggling
 * Allows disabling problematic features without full app crash
 */

import log from "electron-log/main";

export type FeatureName =
  | "TCP_SERVER"
  | "HTTP_POLLING"
  | "ELASTICSEARCH"
  | "FILE_LOGGING"
  | "HEALTH_MONITORING"
  | "ADAPTIVE_BATCHING"
  | "ASYNC_FILE_WRITER";

/** Callback for persisting feature flags */
export type PersistCallback = (
  disabledFeatures: Record<string, string | true>,
) => void;

/**
 * FeatureFlags manages feature availability for graceful degradation
 */
export class FeatureFlags {
  private features = new Map<string, boolean>();
  private disableReasons = new Map<string, string>();
  private persistCallback?: PersistCallback;

  constructor() {
    // Define default feature flags
    this.features.set("TCP_SERVER", true);
    this.features.set("HTTP_POLLING", true);
    this.features.set("ELASTICSEARCH", true);
    this.features.set("FILE_LOGGING", true);
    this.features.set("HEALTH_MONITORING", true);
    this.features.set("ADAPTIVE_BATCHING", true);
    this.features.set("ASYNC_FILE_WRITER", true);
  }

  /**
   * Set callback for persisting feature flags to settings
   */
  setPersistCallback(callback: PersistCallback): void {
    this.persistCallback = callback;
  }

  /**
   * Load disabled features from settings
   */
  loadFromSettings(disabledFeatures?: Record<string, string | true>): void {
    if (!disabledFeatures || typeof disabledFeatures !== "object") {
      return;
    }

    for (const [feature, reasonOrTrue] of Object.entries(disabledFeatures)) {
      if (this.features.has(feature)) {
        this.features.set(feature, false);
        if (typeof reasonOrTrue === "string") {
          this.disableReasons.set(feature, reasonOrTrue);
        }
        log.info(`[feature-flag] ${feature} loaded as disabled from settings`);
      }
    }
  }

  /**
   * Persist current state to settings
   */
  private persist(): void {
    if (!this.persistCallback) return;

    const disabledFeatures: Record<string, string | true> = {};
    for (const [feature, enabled] of this.features) {
      if (!enabled) {
        const reason = this.disableReasons.get(feature);
        disabledFeatures[feature] = reason || true;
      }
    }

    try {
      this.persistCallback(disabledFeatures);
    } catch (err) {
      log.warn(
        "[feature-flag] Failed to persist:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Check if feature is enabled
   */
  isEnabled(feature: string): boolean {
    return this.features.get(feature) ?? false;
  }

  /**
   * Disable a feature
   */
  disable(feature: string, reason?: string): void {
    this.features.set(feature, false);
    if (reason) {
      this.disableReasons.set(feature, reason);
    }
    log.warn(`[feature-flag] ${feature} disabled`, reason ? { reason } : {});
    this.persist();
  }

  /**
   * Enable a feature
   */
  enable(feature: string): void {
    this.features.set(feature, true);
    this.disableReasons.delete(feature);
    log.info(`[feature-flag] ${feature} enabled`);
    this.persist();
  }

  /**
   * Get reason why feature was disabled
   */
  getDisableReason(feature: string): string | undefined {
    return this.disableReasons.get(feature);
  }

  /**
   * Get all features and their status
   */
  getAllFeatures(): Map<string, { enabled: boolean; reason?: string }> {
    const result = new Map<string, { enabled: boolean; reason?: string }>();

    for (const [feature, enabled] of this.features) {
      result.set(feature, {
        enabled,
        reason: this.disableReasons.get(feature),
      });
    }

    return result;
  }

  /**
   * Reset all features to enabled state
   */
  resetAll(): void {
    for (const feature of this.features.keys()) {
      this.features.set(feature, true);
    }
    this.disableReasons.clear();
    log.info("[feature-flag] All features reset to enabled");
    this.persist();
  }

  /**
   * Get statistics about disabled features
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
  } {
    const total = this.features.size;
    const enabled = Array.from(this.features.values()).filter((v) => v).length;
    const disabled = total - enabled;

    return { total, enabled, disabled };
  }
}
