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
const versionFile = path.join(distDir, "version");

function log(msg) {
  console.log(`[fix-electron-install] ${msg}`);
}

/**
 * Liest die vom npm-Paket geforderte Electron-Version aus dessen package.json.
 * Rueckgabe: z. B. "43.0.0" oder null, wenn nicht ermittelbar.
 */
function getRequiredVersion() {
  try {
    return require(path.join(electronDir, "package.json")).version || null;
  } catch {
    return null;
  }
}

/**
 * Ermittelt die aktuell entpackte dist-Version (dist/version), sofern vorhanden.
 */
function getInstalledDistVersion() {
  try {
    return fs.readFileSync(versionFile, "utf8").trim() || null;
  } catch {
    return null;
  }
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

/**
 * Prueft, ob eine funktionsfaehige Binary vorhanden ist UND deren Version zur
 * geforderten Electron-Version passt. Ein Versions-Mismatch (z. B. Binary v39,
 * Paket v43) gilt als "nicht ok".
 */
function installationIsCorrect(requiredVersion) {
  if (!binaryExists()) return false;
  if (!requiredVersion) return true;
  const distVersion = getInstalledDistVersion();
  return distVersion === requiredVersion;
}

/**
 * Sucht im Electron-Cache nach einer Zip. Ist `requiredVersion` gesetzt, wird
 * ausschliesslich die exakt passende Version + Plattform + Architektur
 * akzeptiert (z. B. electron-v43.0.0-darwin-arm64.zip). So wird verhindert,
 * dass eine veraltete Cache-Version (falsche Electron-Version) entpackt wird.
 */
function findCachedZip(requiredVersion) {
  const cacheRoot =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "electron")
      : process.platform === "win32"
        ? path.join(os.homedir(), "AppData", "Local", "electron", "Cache")
        : path.join(os.homedir(), ".cache", "electron");

  if (!fs.existsSync(cacheRoot)) return null;

  // Erwarteter Dateiname fuer die aktuelle Plattform/Architektur.
  const expected = requiredVersion
    ? `electron-v${requiredVersion}-${process.platform}-${process.arch}.zip`.toLowerCase()
    : null;

  let fallback = null;
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
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && /^electron-v.*\.zip$/i.test(e.name)) {
        if (expected) {
          if (e.name.toLowerCase() === expected) return full;
        } else if (!fallback) {
          fallback = full;
        }
      }
    }
  }
  // Ohne bekannte Version: erstes gefundenes Zip als Fallback.
  return expected ? null : fallback;
}

/**
 * Loest einen sauberen Download der geforderten Electron-Version ueber den
 * offiziellen Installer (@electron/get) aus. Fuellt damit den Cache, sodass
 * anschliessend findCachedZip() die passende Zip findet.
 */
function downloadRequiredVersion() {
  const installJs = path.join(electronDir, "install.js");
  if (!fs.existsSync(installJs)) return false;
  log("Starte offiziellen Electron-Download (install.js) ...");
  const result = spawnSync(process.execPath, [installJs], {
    stdio: "inherit",
    cwd: electronDir,
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: "" },
  });
  return result.status === 0;
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

  const requiredVersion = getRequiredVersion();

  // Schritt 1: Newline in path.txt bereinigen (haeufigster Fall)
  ensurePathTxtTrimmed();

  // Schritt 2: Wenn Binary fehlt ODER die Version nicht passt, neu bereitstellen.
  if (!installationIsCorrect(requiredVersion)) {
    const distVersion = getInstalledDistVersion();
    if (binaryExists() && distVersion && requiredVersion && distVersion !== requiredVersion) {
      log(`Versions-Mismatch: installiert v${distVersion}, gefordert v${requiredVersion} -> repariere`);
    } else {
      log("Electron-Binary fehlt -> versuche Reparatur aus Cache");
    }

    let zip = findCachedZip(requiredVersion);

    // Kein passendes Cache-Zip -> offiziellen Download der geforderten Version anstossen.
    if (!zip && requiredVersion) {
      if (downloadRequiredVersion() && installationIsCorrect(requiredVersion)) {
        log("Electron-Installation OK (frisch heruntergeladen)");
        return;
      }
      zip = findCachedZip(requiredVersion);
    }

    if (!zip) {
      log(
        requiredVersion
          ? `Kein passendes Cache-Zip fuer v${requiredVersion} gefunden -> bitte \`npm rebuild electron\` ausfuehren`
          : "Kein Cache-Zip gefunden -> bitte `npm rebuild electron` ausfuehren"
      );
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
  if (installationIsCorrect(requiredVersion)) {
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

