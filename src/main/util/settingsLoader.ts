/**
 * Early Settings Loader
 * Synchronous settings loading utilities for use before app.ready
 * These functions are needed during startup before async operations are possible
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

/** Default heap size in MB */
export const DEFAULT_HEAP_SIZE_MB = 4096;

/** Minimum heap size in MB */
export const MIN_HEAP_SIZE_MB = 512;

/** Maximum heap size in MB (8GB) */
export const MAX_HEAP_SIZE_MB = 8192;

/**
 * Settings that can be loaded early (before app ready)
 */
export interface EarlySettings {
  heapSizeMB: number;
}

/**
 * Get the settings file path
 * Works both in portable and standard installations
 */
export function getSettingsPath(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.length) {
    return path.join(portableDir, "data", "settings.json");
  }
  try {
    return path.join(app.getPath("userData"), "settings.json");
  } catch {
    // Fallback for very early startup before app paths are available
    return path.join(process.cwd(), "settings.json");
  }
}

/**
 * Clamp heap size to valid bounds
 */
export function clampHeapSize(heapSizeMB: number): number {
  return Math.max(MIN_HEAP_SIZE_MB, Math.min(MAX_HEAP_SIZE_MB, heapSizeMB));
}

/**
 * Load heap size from settings synchronously
 * This must be called early in startup before V8 flags are set
 *
 * @returns Heap size in MB (clamped to valid bounds)
 */
export function loadHeapSizeSync(): number {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return DEFAULT_HEAP_SIZE_MB;
    }

    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as { heapSizeMB?: unknown };

    if (typeof parsed.heapSizeMB === "number") {
      return clampHeapSize(parsed.heapSizeMB);
    }

    return DEFAULT_HEAP_SIZE_MB;
  } catch {
    // Silently use default on any error
    return DEFAULT_HEAP_SIZE_MB;
  }
}

/**
 * Load early settings synchronously
 * Consolidates all early settings loading into one function
 */
export function loadEarlySettingsSync(): EarlySettings {
  return {
    heapSizeMB: loadHeapSizeSync(),
  };
}
