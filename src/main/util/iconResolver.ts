/**
 * Icon Resolution Utilities
 * Platform-specific icon path resolution for Windows and macOS
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log/main";

// Cached paths for performance
let cachedIconPath: string | null = null;

/**
 * Validates if a file is a valid ICO format by checking magic bytes
 */
export function isValidIcoFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    // Valid ICO format starts with 0x00 0x00 0x01 0x00
    return (
      buffer[0] === 0x00 &&
      buffer[1] === 0x00 &&
      buffer[2] === 0x01 &&
      buffer[3] === 0x00
    );
  } catch {
    return false;
  }
}

/**
 * Validates file access and readability
 */
export function canAccessFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get candidate paths for icon files
 */
function getIconCandidates(filename: string): string[] {
  const resPath = process.resourcesPath || "";
  const appPath = app.getAppPath?.() || "";
  const cwdPath = process.cwd();

  // For packaged apps, app.getAppPath() returns path to app.asar
  // We need to check app.asar.unpacked for native resources like icons
  const asarUnpackedPath = appPath.replace("app.asar", "app.asar.unpacked");

  return [
    // Production: app.asar.unpacked (highest priority for packaged app with asarUnpack)
    path.join(asarUnpackedPath, "images", filename),
    path.join(resPath, "app.asar.unpacked", "images", filename),
    // Production: Inside ASAR (fallback - may work for some use cases)
    path.join(appPath, "images", filename),
    path.join(resPath, "images", filename),
    // Development: Project root first
    path.join(cwdPath, "images", filename),
    // Development: __dirname and project root
    path.join(__dirname, "images", filename),
    // Additional fallback: Go up from compiled location
    path.join(__dirname, "..", "..", "images", filename),
    path.join(__dirname, "..", "images", filename),
  ].filter(Boolean);
}

/**
 * Resolve Windows ICO icon path synchronously
 */
export function resolveIconPathSync(): string | null {
  if (cachedIconPath !== null) return cachedIconPath || null;

  const candidates = getIconCandidates("icon.ico");

  log.info?.("[icon] resolveIconPathSync searching in candidates:", candidates);
  log.info?.("[icon] app.isPackaged:", app.isPackaged);
  log.info?.("[icon] app.getAppPath():", app.getAppPath?.());
  log.info?.("[icon] process.resourcesPath:", process.resourcesPath);

  for (const candidate of candidates) {
    try {
      const exists = fs.existsSync(candidate);
      log.debug?.("[icon] Checking candidate:", candidate, "exists:", exists);

      if (exists) {
        if (!canAccessFile(candidate)) {
          log.debug?.("[icon] Candidate exists but not readable:", candidate);
          continue;
        }

        if (!isValidIcoFile(candidate)) {
          log.warn?.(
            "[icon] Candidate exists but is not valid ICO format:",
            candidate,
          );
          continue;
        }

        cachedIconPath = candidate;
        log.info?.("[icon] resolveIconPathSync found valid ICO:", candidate);
        return candidate;
      }
    } catch (e) {
      log.debug?.(
        "[icon] resolveIconPathSync error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  log.warn?.("[icon] resolveIconPathSync: no valid candidate found");
  cachedIconPath = "";
  return null;
}

/**
 * Resolve Windows ICO icon path asynchronously
 */
export async function resolveIconPathAsync(): Promise<string | null> {
  if (cachedIconPath !== null) return cachedIconPath || null;

  const candidates = getIconCandidates("icon.ico");

  for (const candidate of candidates) {
    try {
      const exists = await fs.promises
        .access(candidate)
        .then(() => true)
        .catch(() => false);

      if (exists && isValidIcoFile(candidate)) {
        cachedIconPath = candidate;
        log.debug?.("[icon] resolveIconPathAsync found valid ICO:", candidate);
        return candidate;
      }
    } catch (e) {
      log.debug?.(
        "[icon] resolveIconPathAsync error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  log.warn?.("[icon] resolveIconPathAsync: no valid candidate found");
  cachedIconPath = "";
  return null;
}

/**
 * Resolve macOS icon path (ICNS or PNG fallback)
 */
export function resolveMacIconPath(): string | null {
  log.info?.("[icon] resolveMacIconPath called");

  // Try ICNS first (native macOS format)
  const icnsCandidates = getIconCandidates("icon.icns");
  for (const candidate of icnsCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        log.info?.("[icon] resolveMacIconPath ICNS hit:", candidate);
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }

  log.warn?.("[icon] resolveMacIconPath: no ICNS found, trying PNG fallback");

  // Fallback to PNG
  const pngCandidates = getIconCandidates("lumberjack_v4_normal_1024.png");
  for (const candidate of pngCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        log.info?.("[icon] resolveMacIconPath PNG fallback hit:", candidate);
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }

  log.warn?.("[icon] resolveMacIconPath: no candidate exists");
  return null;
}

/**
 * Clear the icon path cache (useful for testing)
 */
export function clearIconCache(): void {
  cachedIconPath = null;
}
