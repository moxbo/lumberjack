#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Filter-Latenz-Lasttest (~300k Einträge)
 *
 * Zweck: Den Effekt des zustandsbehafteten Filter-Workers belegen. Der
 * entscheidende UX-Faktor bei großen Datensätzen ist NICHT die reine
 * Filter-Dauer, sondern wie lange der **Renderer-Hauptthread pro Tastendruck
 * blockiert** ist (währenddessen friert die UI ein: kein Scrollen, kein
 * Tippen, keine Repaints).
 *
 * Vergleich:
 *   - ALT  ("sync"):   Bei >50k Einträgen lief der Filter SYNCHRON im Renderer.
 *                      → Jeder Tastendruck blockiert den Hauptthread für die
 *                        komplette Filterdauer.
 *   - NEU  ("worker"): Einträge werden EINMAL in den Worker gesynct; pro
 *                      Tastendruck wird nur die kleine Optionen-Nachricht
 *                      gesendet. Das Filtern läuft im Worker-Thread.
 *                      → Hauptthread-Blockade pro Tastendruck ≈ 0.
 *
 * Sektionen:
 *   1. Hauptthread-Blockade pro Tastendruck (ALT vs. NEU, gemessen)
 *   2. Einmalige Setup-Kosten des Worker-Pfads (Projektion + Transfer)
 *   3. Echte Off-Thread-Demo via worker_threads: Event-Loop-Reaktivität
 *      während einer simulierten Tipp-Sequenz (ALT vs. NEU)
 *
 * Aufruf: `npm run test:filter-latency`
 *         (für stabilere Werte: `node --expose-gc`-Variante via tsx)
 */

import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { msgMatches } from "../src/utils/msgFilter.js";
import {
  filterProjectionPages,
  mergePassingReferences,
  mergeProjectionRecords,
  normalizeProjection,
} from "../src/workers/filterWorker.js";

// ============================================================================
// Test-Daten (analog scripts/test-performance.ts, leicht vereinfacht)
// ============================================================================

const LEVELS = ["INFO", "DEBUG", "WARN", "ERROR", "TRACE"] as const;
const LOGGERS = [
  "com.example.UserService",
  "com.example.OrderService",
  "com.example.PaymentService",
  "com.example.AuthService",
  "io.acme.gateway.HttpHandler",
  "org.hibernate.SQL",
];

interface SlimEntry {
  level: string;
  logger: string;
  thread: string;
  message: string;
  timestamp: string;
  source: string;
  mdc?: Record<string, unknown>;
  _mark?: string;
}

function generateSlim(count: number): SlimEntry[] {
  const entries: SlimEntry[] = new Array(count);
  const startTime = Date.now() - count * 1000;
  for (let i = 0; i < count; i++) {
    entries[i] = {
      level: LEVELS[i % LEVELS.length]!,
      logger: LOGGERS[i % LOGGERS.length]!,
      thread: `pool-${(i % 8) + 1}-thread-${(i % 32) + 1}`,
      message:
        i % 7 === 0
          ? `Processing request id=${i} userId=user-${i % 1000} took ${(i % 500) + 5}ms (error=${i % 11 === 0})`
          : `Generic log entry number ${i} with payload {"k1":"v1","k2":${i % 99}}`,
      timestamp: new Date(startTime + i * 1000).toISOString(),
      source: "tcp://benchmark",
      mdc: i % 3 === 0 ? { tenant: i % 2 ? "alpha" : "beta" } : undefined,
    };
  }
  return entries;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

// Synchrones Filtern auf dem "Hauptthread" – repliziert die ALT-Logik
// (level + message), die bei >50k Einträgen pro Tastendruck im Renderer lief.
function filterSync(
  entries: SlimEntry[],
  level: string,
  message: string,
): number {
  let passed = 0;
  const lvl = level.toUpperCase();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (lvl && e.level.toUpperCase() !== lvl) continue;
    if (message && !msgMatches(e.message, message)) continue;
    passed++;
  }
  return passed;
}

// Simulierte Tipp-Sequenz: Benutzer tippt "error" Zeichen für Zeichen.
const TYPING: string[] = ["e", "er", "err", "erro", "error"];

const DATASET_SIZE = 300_000;

async function main(): Promise<void> {
  console.log(
    "\n══════════════════════════════════════════════════════════════",
  );
  console.log(
    ` Filter-Latenz-Lasttest – ${DATASET_SIZE.toLocaleString()} Einträge`,
  );
  console.log("══════════════════════════════════════════════════════════════");

  console.log(`\n  Generiere ${DATASET_SIZE.toLocaleString()} Einträge …`);
  const entries = generateSlim(DATASET_SIZE);

  // ==========================================================================
  // 1) Hauptthread-Blockade pro Tastendruck
  // ==========================================================================
  console.log(
    "\n──────────────────────────────────────────────────────────────",
  );
  console.log(" 1) Hauptthread-Blockade pro Tastendruck (gemessen)");
  console.log("──────────────────────────────────────────────────────────────");

  console.log(`\n  ALT (synchron im Renderer):`);
  let oldMax = 0;
  let oldSum = 0;
  for (const q of TYPING) {
    const t0 = performance.now();
    const passed = filterSync(entries, "", q);
    const ms = performance.now() - t0;
    oldMax = Math.max(oldMax, ms);
    oldSum += ms;
    console.log(
      `    tippe "${q.padEnd(6)}" → Block ${ms.toFixed(1).padStart(7)} ms   (passed=${passed.toLocaleString()})`,
    );
  }
  const oldAvg = oldSum / TYPING.length;

  console.log(`\n  NEU (zustandsbehafteter Worker – Hauptthread-Anteil):`);
  // Pro Tastendruck wird nur die Optionen-Nachricht serialisiert/gepostet.
  // Es findet KEIN erneuter Transfer der Einträge statt (bereits gecached,
  // keine neuen Einträge). Wir messen genau diesen Hauptthread-Anteil.
  let newMax = 0;
  let newSum = 0;
  for (const q of TYPING) {
    const options = {
      stdFiltersEnabled: true,
      filter: { level: "", logger: "", thread: "", message: q },
      onlyMarked: false,
      dcFilterEnabled: false,
      dcFilterEntries: [] as unknown[],
      timeFilterEnabled: false,
    };
    const t0 = performance.now();
    // structured clone ≈ JSON-Serialisierung der (winzigen) Optionen
    const payload = JSON.stringify({ type: "filter", options, requestId: 1 });
    void payload.length;
    const ms = performance.now() - t0;
    newMax = Math.max(newMax, ms);
    newSum += ms;
    console.log(
      `    tippe "${q.padEnd(6)}" → Block ${ms.toFixed(3).padStart(7)} ms   (Optionen-Payload ${payload.length} B)`,
    );
  }
  const newAvg = newSum / TYPING.length;

  console.log(`\n  → Hauptthread-Blockade pro Tastendruck:`);
  console.log(
    `      ALT:  Ø ${oldAvg.toFixed(1)} ms,  max ${oldMax.toFixed(1)} ms`,
  );
  console.log(
    `      NEU:  Ø ${newAvg.toFixed(3)} ms,  max ${newMax.toFixed(3)} ms`,
  );
  console.log(
    `      → ${(oldAvg / Math.max(newAvg, 0.0001)).toFixed(0)}x weniger Blockade pro Tastendruck`,
  );

  // ==========================================================================
  // 2) Einmalige Setup-Kosten des Worker-Pfads
  // ==========================================================================
  console.log(
    "\n──────────────────────────────────────────────────────────────",
  );
  console.log(
    " 2) Einmalige Setup-Kosten (Worker-Pfad, NICHT pro Tastendruck)",
  );
  console.log("──────────────────────────────────────────────────────────────");
  const json = JSON.stringify(entries);
  console.log(
    `\n  Slim-Payload (einmaliger Sync an den Worker): ${fmtBytes(json.length)}`,
  );
  console.log(
    `  Diese Kosten fallen nur an, wenn sich der Datensatz ändert –\n  beim Tippen im Filter wird NICHTS davon erneut übertragen.`,
  );

  // ==========================================================================
  // 3) Produktionsnaher paged Filter mit normalisiertem Worker-Cache
  // ==========================================================================
  console.log(
    "\n──────────────────────────────────────────────────────────────",
  );
  console.log(" 3) Produktionsnaher paged Filter");
  console.log("──────────────────────────────────────────────────────────────");
  const projections = entries.map((entry, index) =>
    normalizeProjection({
      id: index + 1,
      timestamp: entry.timestamp,
      level: entry.level,
      logger: entry.logger,
      thread: entry.thread,
      message: entry.message,
      source: entry.source,
      mdc: entry.mdc ?? null,
      service: null,
      traceId: null,
      signature: `entry-${index + 1}`,
      _mark: null,
    }),
  );
  const pagedStart = performance.now();
  const pagedResult = filterProjectionPages([projections], {
    stdFiltersEnabled: true,
    filter: { level: "", logger: "", thread: "", message: "error" },
    onlyMarked: false,
    dcFilterEnabled: false,
    dcFilterEntries: [],
    timeFilterEnabled: false,
  });
  const pagedElapsed = performance.now() - pagedStart;
  console.log(
    `\n  300k Message-Filter: ${pagedElapsed.toFixed(1)} ms (${pagedResult.filteredIndices.length.toLocaleString()} Treffer)`,
  );
  if (pagedElapsed > 1500) {
    throw new Error(
      `Paged message filtering exceeded 1500 ms (${pagedElapsed.toFixed(1)} ms)`,
    );
  }

  const appended = Array.from({ length: 1000 }, (_, offset) => {
    const id = DATASET_SIZE + offset + 1;
    return normalizeProjection({
      id,
      timestamp: new Date(Date.now() + offset).toISOString(),
      level: "INFO",
      logger: "app",
      thread: "main",
      message: `appended error ${id}`,
      source: "tcp:benchmark",
      mdc: null,
      service: null,
      traceId: null,
      signature: `entry-${id}`,
      _mark: null,
    });
  });
  const existingReferences = projections.map((entry, index) => ({
    id: entry.id,
    _id: entry.id,
    timestamp: entry.timestamp,
    message: index < 50_000 ? entry.message : undefined,
    messageLower: index < 50_000 ? entry.messageLower : undefined,
  }));
  const appendedReferences = appended.map((entry) => ({
    id: entry.id,
    _id: entry.id,
    timestamp: entry.timestamp,
    message: entry.message,
    messageLower: entry.messageLower,
  }));
  const appendStart = performance.now();
  mergeProjectionRecords(projections, appended.slice());
  mergePassingReferences(existingReferences, appendedReferences);
  const appendElapsed = performance.now() - appendStart;
  console.log(`  300k + 1k Cache-Ergänzung: ${appendElapsed.toFixed(1)} ms`);
  if (appendElapsed > 100) {
    throw new Error(
      `Paged cache append exceeded 100 ms (${appendElapsed.toFixed(1)} ms)`,
    );
  }

  // ==========================================================================
  // 4) Echte Off-Thread-Demo: Event-Loop-Reaktivität während des Tippens
  // ==========================================================================
  console.log(
    "\n──────────────────────────────────────────────────────────────",
  );
  console.log(" 4) Event-Loop-Reaktivität während simuliertem Tippen");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(
    "\n  Ein 'Reaktivitäts-Tick' alle 4 ms simuliert UI-Arbeit (Repaint/\n  Scroll). Große Lücken = eingefrorene UI.\n",
  );

  // --- ALT: synchrones Filtern blockiert den Tick -------------------------
  const oldStall = await measureStall(async (probe) => {
    for (const q of TYPING) {
      // Pause, damit der Tick laufen könnte …
      await sleep(20);
      // … aber das synchrone Filtern blockiert ihn:
      filterSync(entries, "", q);
    }
    probe.stop();
  });
  console.log(
    `  ALT (sync):    max Tick-Lücke ${oldStall.maxGap.toFixed(1).padStart(7)} ms   (Ticks: ${oldStall.ticks})`,
  );

  // --- NEU: Worker filtert, Hauptthread bleibt frei -----------------------
  const newStall = await runWorkerScenario(entries);
  console.log(
    `  NEU (worker):  max Tick-Lücke ${newStall.maxGap.toFixed(1).padStart(7)} ms   (Ticks: ${newStall.ticks})   Ø Filter-Latenz im Worker: ${newStall.avgWorkerMs.toFixed(1)} ms`,
  );

  console.log(
    `\n  → Die UI bleibt mit dem Worker während des Tippens flüssig\n    (kleine Tick-Lücken), statt pro Tastendruck ~${oldMax.toFixed(0)} ms einzufrieren.`,
  );

  console.log("\n✅ Filter-Latenz-Lasttest abgeschlossen!\n");
}

// ----------------------------------------------------------------------------
// Hilfsfunktionen
// ----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface StallResult {
  maxGap: number;
  ticks: number;
}

interface Probe {
  stop: () => void;
}

/**
 * Misst die maximale Lücke zwischen 4ms-Ticks, während `work` läuft.
 * Eine große Lücke bedeutet, dass der Event-Loop (Hauptthread) blockiert war.
 */
function measureStall(
  work: (probe: Probe) => Promise<void>,
): Promise<StallResult> {
  return new Promise((resolve) => {
    let last = performance.now();
    let maxGap = 0;
    let ticks = 0;
    const interval = setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      maxGap = Math.max(maxGap, gap);
      ticks++;
    }, 4);

    const probe: Probe = {
      stop: () => {
        clearInterval(interval);
        resolve({ maxGap, ticks });
      },
    };

    void work(probe);
  });
}

/**
 * NEU-Szenario mit echtem worker_threads-Worker: Einträge werden einmal
 * gesynct, dann pro Tastendruck nur die Optionen gesendet. Parallel läuft der
 * Reaktivitäts-Tick weiter.
 */
function runWorkerScenario(
  entries: SlimEntry[],
): Promise<StallResult & { avgWorkerMs: number }> {
  // Worker-Code inline (eval), damit der Test keine separate Datei/Build
  // benötigt. Repliziert die zustandsbehaftete Worker-Logik (setEntries +
  // filter über den gecachten Datensatz).
  const workerCode = `
    const { parentPort } = require('node:worker_threads');
    const { performance } = require('node:perf_hooks');
    let cached = [];
    parentPort.on('message', (msg) => {
      if (msg.type === 'setEntries') { cached = msg.entries; parentPort.postMessage({ type: 'ready' }); return; }
      if (msg.type === 'filter') {
        const q = (msg.message || '').toLowerCase();
        const t0 = performance.now();
        let passed = 0;
        for (let i = 0; i < cached.length; i++) {
          const m = cached[i].message;
          if (q && !(m && m.toLowerCase().includes(q))) continue;
          passed++;
        }
        parentPort.postMessage({ type: 'result', requestId: msg.requestId, passed, workerMs: performance.now() - t0 });
      }
    });
  `;

  return new Promise((resolve) => {
    const worker = new Worker(workerCode, { eval: true });
    const workerMsSamples: number[] = [];

    let last = performance.now();
    let maxGap = 0;
    let ticks = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const startProbe = (): void => {
      last = performance.now();
      interval = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
      }, 4);
    };

    const finish = (): void => {
      if (interval) clearInterval(interval);
      void worker.terminate();
      const avgWorkerMs =
        workerMsSamples.reduce((a, b) => a + b, 0) /
        Math.max(workerMsSamples.length, 1);
      resolve({ maxGap, ticks, avgWorkerMs });
    };

    let pending = 0;
    let typingDone = false;

    worker.on("message", (msg: { type: string; workerMs?: number }) => {
      if (msg.type === "ready") {
        startProbe();
        void typeSequence();
        return;
      }
      if (msg.type === "result") {
        if (typeof msg.workerMs === "number")
          workerMsSamples.push(msg.workerMs);
        pending--;
        if (typingDone && pending === 0) finish();
      }
    });

    const typeSequence = async (): Promise<void> => {
      for (const q of TYPING) {
        await sleep(20); // Pause zwischen Tastendrücken
        pending++;
        // Nur die kleine Optionen-Nachricht – kein Re-Transfer der Einträge.
        worker.postMessage({ type: "filter", message: q, requestId: pending });
      }
      typingDone = true;
      if (pending === 0) finish();
    };

    // Einmaliger Sync der Einträge an den Worker.
    worker.postMessage({ type: "setEntries", entries });
  });
}

void main();
