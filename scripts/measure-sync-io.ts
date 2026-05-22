#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Misst die tatsächlichen Kosten der verbleibenden synchronen fs-Aufrufe
 * im Main-Prozess, um zu entscheiden, ob ein Async-Refactor lohnt.
 *
 * Methode:
 *   - Für jede Stelle wird die realistische Datei-Größe simuliert
 *   - 1000 Durchläufe gegen tmpfs/Disk
 *   - Vergleich sync (readFileSync) vs. async (fs.promises.readFile)
 *   - Häufigkeit-im-App-Lifecycle wird gewichtet
 *
 * Verdikt:
 *   - "🟢 unkritisch"   – <1 ms p99 + selten aufgerufen
 *   - "🟡 grenzwertig"  – 1-10 ms p99 oder häufig aufgerufen
 *   - "🔴 refactor"     – >10 ms p99 oder im Hot-Path
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const ITER = 1000;
const WARMUP = 50;

interface Site {
  name: string;
  file: string;
  ref: string;
  bytes: number;
  /** Häufigkeit: Aufrufe pro Stunde (typische Nutzung) */
  callsPerHour: number;
  /** Ist es Hot-Path (blockiert UI/IPC) oder einmalig (Startup)? */
  hotPath: boolean;
}

// Realistische Datei-Größen basierend auf typischen Lumberjack-Installationen
const sites: Site[] = [
  {
    name: "SettingsService.loadSync()",
    file: "settings.json",
    ref: "SettingsService.ts:158",
    bytes: 2_500,
    callsPerHour: 1, // Nur Startup + ggf. emergency reload
    hotPath: false,
  },
  {
    name: "SettingsService.saveSync() prev-read",
    file: "settings-prev.json",
    ref: "SettingsService.ts:237",
    bytes: 2_500,
    callsPerHour: 5, // Bei jedem Save (Settings-Dialog OK)
    hotPath: false,
  },
  {
    name: "ipc filterProfiles:getAll",
    file: "filter-profiles.json",
    ref: "ipcHandlers.ts:1100",
    bytes: 8_000, // ~5-10 Profile mit Bedingungen
    callsPerHour: 20, // Beim Öffnen Dropdown / Window-Open
    hotPath: true, // IPC → blockiert Main bei jedem Render-Request
  },
  {
    name: "ipc alertRules:getAll",
    file: "alert-rules.json",
    ref: "ipcHandlers.ts:1165",
    bytes: 4_000,
    callsPerHour: 20,
    hotPath: true,
  },
  {
    name: "mainI18n locale load",
    file: "de.json",
    ref: "mainI18n.ts:38",
    bytes: 18_000, // typische i18n-Datei
    callsPerHour: 1, // Nur Startup
    hotPath: false,
  },
  {
    name: "CheckpointStore.load()",
    file: "checkpoint.json",
    ref: "CheckpointStore.ts:31",
    bytes: 1_200,
    callsPerHour: 1, // Nur beim Start eines Watch
    hotPath: false,
  },
  {
    name: "main.ts icon load",
    file: "icon.png",
    ref: "main.ts:2023,2086",
    bytes: 52_000, // typische 1024px PNG
    callsPerHour: 1, // Window-Erstellung
    hotPath: false,
  },
  {
    name: "settingsLoader.ts startup",
    file: "settings-loader.json",
    ref: "util/settingsLoader.ts:64",
    bytes: 2_500,
    callsPerHour: 1, // Nur Bootstrap
    hotPath: false,
  },
];

function quantile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

function statsFor(samples: number[]): {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: sum / sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
  };
}

async function benchSite(site: Site, tmpDir: string): Promise<void> {
  const filePath = path.join(tmpDir, site.file);
  // Realistische Daten: PNG = binary, alle anderen JSON-ähnlich
  const payload = site.file.endsWith(".png")
    ? Buffer.alloc(site.bytes, 0xab)
    : Buffer.from(
        JSON.stringify({
          x: "y".repeat(Math.max(0, site.bytes - 20)),
        }).slice(0, site.bytes),
      );
  fs.writeFileSync(filePath, payload);

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    fs.readFileSync(filePath);
  }
  for (let i = 0; i < WARMUP; i++) {
    await fsp.readFile(filePath);
  }

  // Sync
  const syncMs: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t = performance.now();
    fs.readFileSync(filePath);
    syncMs.push(performance.now() - t);
  }

  // Async
  const asyncMs: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t = performance.now();
    await fsp.readFile(filePath);
    asyncMs.push(performance.now() - t);
  }

  const s = statsFor(syncMs);
  const a = statsFor(asyncMs);

  // Verdikt
  // Annahme: Main-Loop-Blockade > 5 ms wird im UI spürbar
  // Hot-Path mit p99 > 1ms = stört IPC-Responsiveness
  let verdict: string;
  if (site.hotPath && s.p99 > 5) {
    verdict = "🔴 refactor (Hot-Path + p99>5ms)";
  } else if (site.hotPath && s.p99 > 1) {
    verdict = "🟡 grenzwertig (Hot-Path)";
  } else if (s.p99 > 10) {
    verdict = "🟡 grenzwertig (Latenz)";
  } else {
    verdict = "🟢 unkritisch";
  }

  // Hochrechnung: jährlicher Blockade-Zeitanteil
  const blockedMsPerHour = s.mean * site.callsPerHour;
  const blockedSecPerDay = (blockedMsPerHour * 24) / 1000;

  console.log(
    `${site.name}\n` +
      `  ref          ${site.ref}\n` +
      `  bytes        ${site.bytes.toLocaleString()}\n` +
      `  calls/h      ${site.callsPerHour}    hot-path: ${site.hotPath}\n` +
      `  sync   mean=${s.mean.toFixed(3)}ms  p50=${s.p50.toFixed(3)}  p95=${s.p95.toFixed(3)}  p99=${s.p99.toFixed(3)}ms\n` +
      `  async  mean=${a.mean.toFixed(3)}ms  p50=${a.p50.toFixed(3)}  p95=${a.p95.toFixed(3)}  p99=${a.p99.toFixed(3)}ms\n` +
      `  Δmean        ${(a.mean - s.mean).toFixed(3)}ms (async-sync; negativ=sync schneller)\n` +
      `  blockade/Tag ~${blockedSecPerDay.toFixed(3)}s main-loop\n` +
      `  ► ${verdict}\n`,
  );
}

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-sync-io-bench-"));
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" Lumberjack sync-I/O Bedarfsanalyse");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(` Node:      ${process.version}`);
  console.log(` Platform:  ${process.platform} ${process.arch}`);
  console.log(` tmpDir:    ${tmpDir}`);
  console.log(` Iterationen: ${ITER} (Warmup ${WARMUP})`);
  console.log("");

  try {
    for (const site of sites) {
      await benchSite(site, tmpDir);
    }

    console.log(
      "══════════════════════════════════════════════════════════════",
    );
    console.log(" Verdikt (zusammengefasst)");
    console.log(
      "══════════════════════════════════════════════════════════════",
    );
    console.log(
      "  🟢 unkritisch   – kein Refactor nötig (Startup-Pfade, kleine JSON)",
    );
    console.log(
      "  🟡 grenzwertig  – Refactor nice-to-have (IPC-Pfade mit häufigen Calls)",
    );
    console.log(
      "  🔴 refactor     – Refactor empfohlen (Hot-Path mit nennenswerter Latenz)",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
