/**
 * Application Constants
 * Central location for all magic numbers and configuration values
 */

// Environment detection
export const isDev =
  process.env.NODE_ENV === "development" ||
  Boolean(process.env.VITE_DEV_SERVER_URL);

// Command line flags
export const MULTI_INSTANCE_FLAG = "--multi-instance";
export const NEW_WINDOW_FLAG = "--new-window";

// Buffer and batch limits - reduced batch size to prevent UI freezes ("Keine Rückmeldung")
export const DEFAULT_MAX_PENDING_APPENDS = 5000;
export const MIN_PENDING_APPENDS = 1000;
export const MAX_BATCH_ENTRIES = 100; // Reduced from 200 for smoother UI
export const MAX_MESSAGE_LENGTH = 10 * 1024; // 10 KB per text field

// Memory thresholds for adaptive buffer sizing
export const MEMORY_HIGH_THRESHOLD = 0.75; // 75% heap usage
export const MEMORY_LOW_THRESHOLD = 0.4; // 40% heap usage
export const MEMORY_CHECK_INTERVAL_MS = 10000; // 10 seconds

// Health monitoring
export const HEALTH_CHECK_INTERVAL_MS = 60000; // 1 minute
export const HEALTH_MEMORY_THRESHOLD = 0.9; // 90% for unhealthy

// Log file settings
export const LOG_FILE_MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Window defaults
export const DEFAULT_WINDOW_WIDTH = 1200;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const DEFAULT_WINDOW_TITLE = "Lumberjack";

// App identifiers - must match "appId" in package.json build config
export const APP_ID_WINDOWS = "de.moxbo.lumberjack";
export const APP_ID_BUILD = "de.moxbo.lumberjack";

// Truncation fields for renderer
export const TRUNCATION_FIELDS = [
  "message",
  "raw",
  "msg",
  "body",
  "message_raw",
  "text",
] as const;
