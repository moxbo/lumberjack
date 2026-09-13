import { useMemo } from "preact/hooks";
import {
  EntryIdSnapshot,
  type ReadonlySequence,
} from "../utils/metadataSnapshot";
import { IdPositionVector } from "../utils/idPositionVector";

export interface IdPositions {
  /** Zero-based position, or -1 when absent from this particular snapshot. */
  get(id: number): number;
}

export function createIdPositions(ids: ReadonlySequence<number>): IdPositions {
  if (ids instanceof EntryIdSnapshot) {
    return { get: (id) => ids.positionOf(id) };
  }
  // Worker/search results carry no unchanged-prefix proof. Always rebuild;
  // matching first/last IDs does not prove that the middle stayed unchanged.
  const positions = new IdPositionVector();
  ids.forEach((id, position) => positions.set(id, position));
  return positions;
}

export function useIdPositions(ids: ReadonlySequence<number>): IdPositions {
  return useMemo(() => createIdPositions(ids), [ids]);
}
