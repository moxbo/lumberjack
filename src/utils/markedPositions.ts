import { entrySignature } from "./entryUtils";

export type MarkedPositionIndex = Map<string, number | number[]>;

export function buildMarkedPositionIndex(
  entries: unknown[],
  filteredIndices: number[],
  limit = 100_000,
): MarkedPositionIndex {
  const index: MarkedPositionIndex = new Map();
  const scanLimit = Math.min(filteredIndices.length, limit);

  for (let visualIndex = 0; visualIndex < scanLimit; visualIndex++) {
    const entry = entries[filteredIndices[visualIndex]!] as object | undefined;
    if (!entry) continue;
    const signature = entrySignature(entry);
    const current = index.get(signature);
    if (current === undefined) {
      index.set(signature, visualIndex);
    } else if (typeof current === "number") {
      index.set(signature, [current, visualIndex]);
    } else {
      current.push(visualIndex);
    }
  }
  return index;
}

export function resolveMarkedPositions(
  index: MarkedPositionIndex | null,
  marksMap: Record<string, string>,
): number[] {
  if (!index) return [];

  const positions: number[] = [];
  for (const signature of Object.keys(marksMap)) {
    const matched = index.get(signature);
    if (matched === undefined) continue;
    if (typeof matched === "number") positions.push(matched);
    else positions.push(...matched);
  }
  positions.sort((a, b) => a - b);
  return positions;
}
