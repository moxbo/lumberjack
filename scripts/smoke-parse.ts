#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parsePaths } from '../src/parsers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
  const base = path.resolve(__dirname, '..');
  const files = [path.join(base, 'adapter.teams_json.log')].filter((p) => fs.existsSync(p));

  if (!files.length) {
    console.log('Keine Beispiel-Logs gefunden.');
    process.exit(0);
  }

  const entries = parsePaths(files);
  console.log('Dateien:', files.map((f) => path.basename(f)).join(', '));
  console.log('Gesamt Einträge:', entries.length);
  const levels = entries.reduce((acc: any, e: any) => {
    const l = (e.level || 'UNK').toUpperCase();
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {});
  console.log('Level Verteilung:', levels);
  console.log('Beispiel-Eintrag:', entries[0]);
}

main();
