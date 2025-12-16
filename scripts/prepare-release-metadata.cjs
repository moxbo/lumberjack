#!/usr/bin/env node
/**
 * Kopiert die Root package.json minimal bereinigt in release/app, damit electron-builder
 * den Two-Package-Structure-Modus nutzen kann. Entfernt dev-only Felder.
 * Kopiert auch die images/ für das App-Icon.
 */
const fs = require('fs');
const path = require('path');

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
