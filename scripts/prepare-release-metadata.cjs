#!/usr/bin/env node
/**
 * Kopiert die Root package.json minimal bereinigt in release/app, damit electron-builder
 * den Two-Package-Structure-Modus nutzen kann. Entfernt dev-only Felder.
 * Kopiert auch die images/ für das App-Icon.
 *
 * Ermittelt automatisch die Version aus:
 * 1. Umgebungsvariable RELEASE_VERSION (z.B. von CI/CD)
 * 2. Git-Tag auf aktuellem Commit (v1.0.5 → 1.0.5)
 * 3. Git describe (für Entwicklungs-Builds)
 * 4. Fallback: package.json Version
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootPkgPath = path.join(__dirname, '..', 'package.json');
const targetDir = path.join(__dirname, '..', 'release', 'app');
const targetPkgPath = path.join(targetDir, 'package.json');

// Source and target for images
const imagesSourceDir = path.join(__dirname, '..', 'images');
const imagesTargetDir = path.join(targetDir, 'images');

// Source and target for locales
const localesSourceDir = path.join(__dirname, '..', 'src', 'locales');
const localesTargetDir = path.join(targetDir, 'dist', 'locales');

/**
 * Ermittelt die Version aus Git-Tags oder Umgebungsvariable
 */
function getVersionFromGit(fallbackVersion) {
  // 1. Umgebungsvariable hat höchste Priorität (z.B. von GitHub Actions)
  if (process.env.RELEASE_VERSION) {
    const version = process.env.RELEASE_VERSION.replace(/^v/, '');
    console.log('[prepare-release-metadata] Version aus RELEASE_VERSION:', version);
    return version;
  }

  try {
    // 2. Prüfe ob aktueller Commit ein Tag hat
    const tag = execSync('git describe --tags --exact-match HEAD 2>/dev/null', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (tag && tag.startsWith('v')) {
      const version = tag.replace(/^v/, '');
      console.log('[prepare-release-metadata] Version aus Git-Tag:', version);
      return version;
    }
  } catch {
    // Kein exakter Tag auf HEAD
  }

  try {
    // 3. Git describe für Entwicklungs-Builds (z.B. 1.0.4-3-g1234abc)
    const describe = execSync('git describe --tags --always 2>/dev/null', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (describe) {
      // Format: v1.0.4-3-g1234abc → 1.0.4-dev.3
      const match = describe.match(/^v?(\d+\.\d+\.\d+)(?:-(\d+)-g[a-f0-9]+)?$/);
      if (match) {
        if (match[2]) {
          // Entwicklungs-Build
          const version = `${match[1]}-dev.${match[2]}`;
          console.log('[prepare-release-metadata] Version aus git describe (dev):', version);
          return version;
        }
        // Genau auf einem Tag
        console.log('[prepare-release-metadata] Version aus git describe:', match[1]);
        return match[1];
      }
    }
  } catch {
    // Git nicht verfügbar oder kein Git-Repo
  }

  // 4. Fallback auf package.json Version
  console.log('[prepare-release-metadata] Version aus package.json (Fallback):', fallbackVersion);
  return fallbackVersion;
}

/**
 * Recursively copy a directory
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('[prepare-release-metadata] source dir not found:', src);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function run() {
  const raw = fs.readFileSync(rootPkgPath, 'utf8');
  const pkg = JSON.parse(raw);

  // Ermittle Version aus Git oder Umgebungsvariable
  const version = getVersionFromGit(pkg.version);
  pkg.version = version;

  delete pkg.devDependencies;
  delete pkg.scripts;
  delete pkg.overrides;
  delete pkg.build;
  // Erzwinge CommonJS im gepackten App-Kontext, damit esbuild-CJS Bundles korrekt laufen
  pkg.type = 'commonjs';
  pkg.main = 'dist/main/main.js';
  pkg.private = false;
  // Setze productName und description für korrekten Anwendungsnamen im Task-Manager
  pkg.productName = 'Lumberjack';
  pkg.description = 'Lumberjack';
  // Setze name auf lumberjack (lowercase für internen Gebrauch)
  pkg.name = 'lumberjack';
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2));
  console.log('[prepare-release-metadata] wrote', targetPkgPath);
  console.log('[prepare-release-metadata] version:', version);
  console.log('[prepare-release-metadata] set type=commonjs');
  console.log('[prepare-release-metadata] set productName=Lumberjack');
  console.log('[prepare-release-metadata] set description=Lumberjack');

  // Copy images folder for app icon
  copyDir(imagesSourceDir, imagesTargetDir);
  console.log('[prepare-release-metadata] copied images to', imagesTargetDir);

  // Copy locale files (only .json files)
  if (!fs.existsSync(localesTargetDir)) {
    fs.mkdirSync(localesTargetDir, { recursive: true });
  }
  if (fs.existsSync(localesSourceDir)) {
    const localeFiles = fs.readdirSync(localesSourceDir).filter(f => f.endsWith('.json'));
    for (const file of localeFiles) {
      fs.copyFileSync(
        path.join(localesSourceDir, file),
        path.join(localesTargetDir, file)
      );
    }
    console.log('[prepare-release-metadata] copied locales to', localesTargetDir);
  }
}
run();
