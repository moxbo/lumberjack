#!/usr/bin/env node
/**
 * Kopiert die Root package.json minimal bereinigt in release/app, damit electron-builder
 * den Two-Package-Structure-Modus nutzen kann. Entfernt dev-only Felder.
 */
const fs = require('fs');
const path = require('path');

const rootPkgPath = path.join(__dirname, '..', 'package.json');
const targetDir = path.join(__dirname, '..', 'release', 'app');
const targetPkgPath = path.join(targetDir, 'package.json');

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
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2));
  console.log('[prepare-release-metadata] wrote', targetPkgPath);
  console.log('[prepare-release-metadata] set type=commonjs');
}
run();
