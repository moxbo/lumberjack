#!/usr/bin/env node
/*
 * Heilt zwei bekannte Probleme der Electron-Installation auf Node 24 / macOS:
 *
 *  1) extract-zip 2.x bricht unter Node 24 silent ab, sodass nur LICENSE
 *     und LICENSES.chromium.html im dist/-Verzeichnis landen (kein Binary,
 *     kein path.txt). Symptom: ENOENT auf path.txt beim ersten Start.
 *
 *  2) Wird path.txt von Hand erzeugt und enthaelt ein abschliessendes
 *     Newline, schlaegt fs.existsSync(fullPath) in electron/index.js fehl
 *     -> es wird ein Re-Download ausgeloest, der dann am bereits
 *     existierenden Framework-Symlink mit EEXIST scheitert.
 *
 * Dieses Script ist idempotent und macht NICHTS, wenn die Installation
 * bereits korrekt ist. Es wird als Teil von `npm install` (postinstall) und
 * vor `dev` / `start` ausgefuehrt.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const pathFile = path.join(electronDir, "path.txt");

function log(msg) {
  console.log(`[fix-electron-install] ${msg}`);
}

function getPlatformBinaryRelPath() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    default:
      return "electron";
  }
}

function ensurePathTxtTrimmed() {
  if (!fs.existsSync(pathFile)) return false;
  const raw = fs.readFileSync(pathFile, "utf8");
  const trimmed = raw.trim();
  if (raw !== trimmed) {
    fs.writeFileSync(pathFile, trimmed, "utf8");
    log(`path.txt von Whitespace bereinigt (war: ${raw.length} bytes, jetzt: ${trimmed.length} bytes)`);
    return true;
  }
  return false;
}

function binaryExists() {
  const rel = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, "utf8").trim() : getPlatformBinaryRelPath();
  if (!rel) return false;
  return fs.existsSync(path.join(distDir, rel));
}

function findCachedZip() {
  const cacheRoot =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "electron")
      : process.platform === "win32"
        ? path.join(os.homedir(), "AppData", "Local", "electron", "Cache")
        : path.join(os.homedir(), ".cache", "electron");

  if (!fs.existsSync(cacheRoot)) return null;
  const stack = [cacheRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^electron-v.*\.zip$/i.test(e.name)) return full;
    }
  }
  return null;
}

function extractWithSystemUnzip(zipPath) {
  // Vor dem Entpacken alten Inhalt entfernen, damit Symlinks neu angelegt werden koennen.
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
  const result = spawnSync("unzip", ["-q", zipPath, "-d", distDir], { stdio: "inherit" });
  return result.status === 0;
}

function writePathTxt() {
  fs.writeFileSync(pathFile, getPlatformBinaryRelPath(), "utf8");
  log(`path.txt geschrieben: ${getPlatformBinaryRelPath()}`);
}

function main() {
  if (!fs.existsSync(electronDir)) {
    // electron noch nicht installiert -> nichts zu tun
    return;
  }

  // Schritt 1: Newline in path.txt bereinigen (haeufigster Fall)
  ensurePathTxtTrimmed();

  // Schritt 2: Wenn Binary fehlt, aus Cache mit System-unzip extrahieren
  if (!binaryExists()) {
    log("Electron-Binary fehlt -> versuche Reparatur aus Cache");
    const zip = findCachedZip();
    if (!zip) {
      log("Kein Cache-Zip gefunden -> bitte `npm rebuild electron` ausfuehren");
      return;
    }
    log(`Cache-Zip gefunden: ${zip}`);
    if (process.platform === "win32") {
      // Auf Windows kein /usr/bin/unzip -> Fallback auf PowerShell Expand-Archive
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${zip}' -DestinationPath '${distDir}'`],
        { stdio: "inherit" }
      );
      if (result.status !== 0) {
        log("Expand-Archive fehlgeschlagen");
        return;
      }
    } else if (!extractWithSystemUnzip(zip)) {
      log("unzip fehlgeschlagen");
      return;
    }
    writePathTxt();
  }

  // Schritt 3: Final-Check
  if (binaryExists()) {
    log("Electron-Installation OK");
  } else {
    log("WARNUNG: Electron-Installation weiterhin nicht funktionsfaehig");
  }
}

try {
  main();
} catch (err) {
  console.error(`[fix-electron-install] unerwarteter Fehler: ${err.message}`);
  // Niemals den npm-install brechen
  process.exit(0);
}

