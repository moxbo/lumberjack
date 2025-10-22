#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { parsePaths } = require('../src/parsers');

function main() {
  const base = path.resolve(__dirname, '..');
  const files = [
    path.join(base, 'adapter.teams_json.log'),
  ].filter((p) => fs.existsSync(p));

  if (!files.length) {
    console.log('Keine Beispiel-Logs gefunden.');
    process.exit(0);
  }

  const entries = parsePaths(files);
  console.log('Dateien:', files.map((f) => path.basename(f)).join(', '));
  console.log('Gesamt Einträge:', entries.length);
  const levels = entries.reduce((acc, e) => { const l = (e.level || 'UNK').toUpperCase(); acc[l] = (acc[l]||0)+1; return acc; }, {});
  console.log('Level Verteilung:', levels);
  console.log('Beispiel-Eintrag:', entries[0]);
}

main();

