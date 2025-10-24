/**
 * Common types used across renderer components
 */

import type { LogEntry } from './ipc';

/**
 * Extended log entry with UI-specific fields
 */
export interface UILogEntry extends LogEntry {
  _id: number;
  _matchesMsgFilter?: boolean;
  _matchesDC?: boolean;
}

/**
 * Settings dialog tab
 */
export type SettingsTab = 'general' | 'tcp' | 'http' | 'elastic' | 'file-log';

/**
 * Theme mode
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * Filter state for log entries
 */
export interface FilterState {
  level: string;
  logger: string;
  thread: string;
  traceId: string;
  message: string;
  source: string;
}
