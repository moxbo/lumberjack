export const rows = 50_000;
export const repetitions = 3;
export const needle = "board-payment-timeout";
export const absent = "board-never-present";
export const phases = ["first", "noMatch", "repeat"] as const;
export const metrics = ["visibleMs", "completeMs", "longestTaskMs"] as const;
export type Metrics = Record<(typeof metrics)[number], number>;
export type Sample = {
  fixtureHash: string;
  electron: string;
  phases: Record<(typeof phases)[number], Metrics>;
};

export function makeFixture() {
  let hits = 0;
  const lines = Array.from({ length: rows }, (_, i) => {
    // Neither end of the unfiltered list should already display a matching row.
    const match = i >= rows / 4 && i < (3 * rows) / 4 && i % 50 === 0;
    if (match) hits++;
    return JSON.stringify({
      timestamp: new Date(1_700_000_000_000 + i).toISOString(),
      level: match ? "ERROR" : "INFO",
      logger: `board.service.${i % 8}`,
      message: `${match ? needle : "payment-accepted"} request ${i}`,
    });
  });
  return { content: lines.join("\n") + "\n", hits };
}
