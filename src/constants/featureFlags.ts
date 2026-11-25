export const FEATURE_NAMES = [
  "TCP_SERVER",
  "HTTP_POLLING",
  "ELASTICSEARCH",
  "FILE_LOGGING",
  "HEALTH_MONITORING",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
