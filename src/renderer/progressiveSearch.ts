import type { ReadonlySequence } from "../utils/metadataSnapshot";

/** Worker positions belong to its partial projection, not necessarily the UI. */
export function searchMatchPositions(
  ids: readonly number[],
  positionOf: (id: number) => number,
): number[] {
  const positions: number[] = [];
  for (const id of ids) {
    const position = positionOf(id);
    if (position >= 0) positions.push(position);
  }
  return positions.sort((a, b) => a - b);
}

export function anchoredScrollOffset(
  previous: ReadonlySequence<number>,
  scrollTop: number,
  positionOf: (id: number) => number,
  rowHeight: number,
): number | null {
  const index = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const id = previous.at(index);
  if (id === undefined) return null;
  const nextIndex = positionOf(id);
  return nextIndex < 0
    ? null
    : nextIndex * rowHeight + (scrollTop - index * rowHeight);
}

export function shouldNavigateCommittedSearch(
  draft: string,
  committed: string,
) {
  return draft === committed && !!draft.trim();
}
