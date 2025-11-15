#!/usr/bin/env node
/**
 * Kopiert die Root package.json minimal bereinigt in release/app, damit electron-builder
 * den Two-Package-Structure-Modus nutzen kann. Entfernt dev-only Felder.
 */
const fs = require("fs");
const path = require("path");

const rootPkgPath = path.join(__dirname, "..", "package.json");
const targetDir = path.join(__dirname, "..", "release", "app");
const targetPkgPath = path.join(targetDir, "package.json");

function run() {
  const raw = fs.readFileSync(rootPkgPath, "utf8");
  const pkg = JSON.parse(raw);
  // Felder entfernen, die für das distributable nicht nötig sind
  delete pkg.devDependencies;
  delete pkg.scripts; // Wird für das gepackte App-Verzeichnis nicht benötigt
  delete pkg.overrides;
  // build im Root lassen wir weg im Release-App package.json, damit builder eigene config liest
  delete pkg.build;

  // Minimale Felder sicherstellen
  pkg.main = "dist/main/main.js";
  pkg.private = false;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2));
  console.log("[prepare-release-metadata] wrote", targetPkgPath);
}

run();
