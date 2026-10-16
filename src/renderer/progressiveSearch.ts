import type { ReadonlySequence } from "../utils/metadataSnapshot";

/** Worker positions belong to its partial projection, not necessarily the UI. */
export function searchMatchPositions(
  ids: readonly number[],
  positionOf: (id: number) => number,
): number[] {
  const positions: number[] = [];
  let ordered = true;
  for (const id of ids) {
    const position = positionOf(id);
    if (position >= 0) {
      if (positions.length && position < positions[positions.length - 1]!)
        ordered = false;
      positions.push(position);
    }
  }
  return ordered ? positions : positions.sort((a, b) => a - b);
}

function firstMatchAtOrAfter(
  positions: readonly number[],
  position: number,
): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (positions[middle]! < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function searchMatchIndex(
  positions: readonly number[],
  position: number,
): number {
  const index = firstMatchAtOrAfter(positions, position);
  return index < positions.length && positions[index] === position ? index : -1;
}

export function adjacentSearchMatch(
  positions: readonly number[],
  currentPosition: number,
  direction: number,
): number | undefined {
  if (!positions.length) return undefined;
  if (currentPosition < 0)
    return direction > 0 ? positions[0] : positions[positions.length - 1];
  const index = firstMatchAtOrAfter(positions, currentPosition);
  const next =
    direction > 0
      ? index + (positions[index] === currentPosition ? 1 : 0)
      : index - 1;
  return positions[Math.max(0, Math.min(positions.length - 1, next))];
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
