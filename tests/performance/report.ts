import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { metrics, phases, repetitions, rows, type Sample } from "./scenario";

const dir = resolve("performance-board");
const runs = join(dir, "runs");
const files = (await readdir(runs, { recursive: true }))
  .filter((name) => basename(name) === "sample.json")
  .sort();
const samples: Sample[] = await Promise.all(
  files.map(
    async (path) =>
      JSON.parse(await readFile(join(runs, path), "utf8")) as Sample,
  ),
);
const board = {
  schema: 1,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.env.PERF_BOARD_APP_ROOT || ".",
    encoding: "utf8",
  }).trim(),
  platform: `${process.platform}/${process.arch}`,
  rows,
  samples,
};
type Board = typeof board;

function verify(b: Board) {
  if (
    b.schema !== board.schema ||
    b.rows !== rows ||
    b.platform !== board.platform ||
    !Array.isArray(b.samples) ||
    b.samples.length !== repetitions
  )
    throw new Error(
      "Cannot compare performance boards: schema, workload, platform or repeat count differs",
    );
  for (const sample of b.samples) {
    if (!sample.fixtureHash || sample.fixtureHash !== samples[0]?.fixtureHash)
      throw new Error(
        "Cannot compare performance boards: fixture hash differs",
      );
    for (const phase of phases) {
      for (const metric of metrics) {
        const ms = sample.phases[phase][metric];
        if (!Number.isFinite(ms) || ms < 0)
          throw new Error(`Missing or invalid ${phase}/${metric} measurement`);
      }
    }
  }
}

verify(board);
const baseline: Board | undefined = process.env.PERF_BOARD_BASELINE
  ? (JSON.parse(
      await readFile(process.env.PERF_BOARD_BASELINE, "utf8"),
    ) as Board)
  : undefined;
if (baseline) verify(baseline);

function median(
  b: Board,
  phase: (typeof phases)[number],
  metric: (typeof metrics)[number],
) {
  const values = b.samples
    .map((s) => s.phases[phase][metric])
    .sort((a, b) => a - b);
  return (
    (values[Math.floor((values.length - 1) / 2)]! +
      values[Math.floor(values.length / 2)]!) /
    2
  );
}
const phaseLabels = {
  first: "First search",
  noMatch: "No matches",
  repeat: "Repeated search",
};
const metricLabels = {
  visibleMs: "First visible result",
  completeMs: "Complete list",
  longestTaskMs: "Longest UI task",
};
const describe = (b: Board) =>
  `\`${b.commit.slice(0, 12)}\` (Electron ${b.samples[0]!.electron})`;
const lines = [
  "# Filter performance board",
  "",
  `Measured: ${describe(board)} on ${board.platform}. ${baseline ? `Baseline: ${describe(baseline)}.` : "No baseline supplied."}`,
  `Medians of ${samples.length} independent sessions, ${rows.toLocaleString("en-US")} synthetic entries. Lower is better; timing differences are informational.`,
  "",
  "| Scenario | Metric | Current (ms) | Baseline (ms) | Change (ms) |",
  "| --- | --- | ---: | ---: | ---: |",
];
for (const phase of phases) {
  for (const metric of metrics) {
    const value = median(board, phase, metric);
    const base = baseline && median(baseline, phase, metric);
    const delta = base === undefined ? undefined : value - base;
    lines.push(
      `| ${phaseLabels[phase]} | ${metricLabels[metric]} | ${value.toFixed(1)} | ${base?.toFixed(1) ?? "-"} | ${delta === undefined ? "-" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`} |`,
    );
  }
}
lines.push(
  "",
  "First visible result includes the no-match message. Complete list requires the expected count and finished progress. Longest UI task is the overlap with a renderer Long Task (tasks of 50 ms or more); 0 means none observed.",
  "",
);
await writeFile(
  join(dir, "results.json"),
  JSON.stringify(board, null, 2) + "\n",
);
await writeFile(join(dir, "report.md"), lines.join("\n"));
process.stdout.write(
  `${lines.join("\n")}\nSaved in performance-board/ (report.md and results.json).\n`,
);
