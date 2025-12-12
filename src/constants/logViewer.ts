/**
 * Constants for the Log Viewer application
 */

// Base mark colors for log highlighting
export const BASE_MARK_COLORS = [
  "#F59E0B", // amber
  "#EF4444", // red
  "#10B981", // emerald
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#6B7280", // gray
];

// Memory limits for renderer process stability
// Maximum number of log entries to keep in memory
// This is a safety limit - should rarely be hit in normal usage
export const MAX_RENDERER_ENTRIES = 1_000_000;

// Threshold at which to start trimming (allows for burst handling)
export const TRIM_THRESHOLD_ENTRIES = MAX_RENDERER_ENTRIES * 0.95; // 950,000

// IPC batching configuration to prevent renderer overload
export const IPC_BATCH_SIZE = 5000; // Max entries to process in one batch
export const IPC_PROCESS_INTERVAL = 50; // Min interval between processing batches (ms)
export const IPC_MAX_QUEUE_SIZE = 100_000; // Maximum queue size to prevent memory issues

// Virtualizer configuration
export const DEFAULT_ROW_HEIGHT = 36;
export const DEFAULT_OVERSCAN = 15;

// Filter history configuration
export const MAX_FILTER_HISTORY = 20;
export const MAX_ELASTIC_HISTORY = 10;

// Log levels
export const LOG_LEVELS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Column width constraints (in pixels)
export const COLUMN_CONSTRAINTS = {
  timestamp: { min: 140, max: 600 },
  level: { min: 70, max: 200 },
  logger: { min: 160, max: 800 },
} as const;

// Detail panel constraints (in pixels)
export const DETAIL_PANEL_CONSTRAINTS = {
  minHeight: 150,
  minListHeight: 140,
} as const;
