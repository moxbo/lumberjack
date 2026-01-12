/**
 * Renderer-specific type extensions
 * These types extend the base IPC types with renderer-specific properties
 */

import type { LogEntry } from "./ipc";

/**
 * Extended LogEntry type for renderer with additional display properties
 * These properties are added by the renderer and not part of the IPC contract
 */
export interface RendererLogEntry extends LogEntry {
  /** Mark color for highlighting (e.g., "#F59E0B") */
  _mark?: string;
  /** Alternative color property (legacy support) */
  color?: string;
  /** Entry has been processed by IPC batch processor */
  _processed?: boolean;
  /** Internal ID assigned by renderer */
  _id?: number;
}

/**
 * Filter statistics for debugging
 */
export interface FilterStats {
  total: number;
  passed: number;
  rejectedByOnlyMarked: number;
  rejectedByLevel: number;
  rejectedByLogger: number;
  rejectedByThread: number;
  rejectedByMessage: number;
  rejectedByTime: number;
  rejectedByDC: number;
}

/**
 * Elasticsearch form state for the search dialog
 */
export interface ElasticFormState {
  enabled: boolean;
  mode: "relative" | "absolute";
  duration: string;
  from: string;
  to: string;
  application_name: string;
  logger: string;
  level: string;
  environment: string;
  index: string;
  environmentCase: "original" | "lower" | "upper" | "case-sensitive";
  message?: string;
  sort?: "asc" | "desc";
  /** Allow insecure TLS connections */
  allowInsecureTLS?: boolean;
}

/**
 * Settings form state for the settings modal
 */
export interface SettingsFormState {
  tcpPort: number;
  httpUrl: string;
  httpInterval: number;
  logToFile: boolean;
  logFilePath: string;
  logMaxMB: number;
  logMaxBackups: number;
  themeMode: string;
  elasticUrl: string;
  elasticSize: number;
  elasticUser: string;
  elasticPassNew: string;
  elasticPassClear: boolean;
  elasticMaxParallel: number;
  allowPrerelease: boolean;
  heapSizeMB: number;
}

/**
 * Theme mode options
 */
export type ThemeMode = "system" | "light" | "dark";

/**
 * Settings tab options
 */
export type SettingsTab =
  | "tcp"
  | "http"
  | "elastic"
  | "logging"
  | "appearance"
  | "features";
