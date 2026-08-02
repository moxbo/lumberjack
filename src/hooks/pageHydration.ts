export const MAX_HYDRATED_PAYLOADS = 512;

export function uniqueHydrationIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

export function pruneHydratedPayloads<T>(
  current: ReadonlyMap<number, T>,
  requestedIds: readonly number[],
  incoming: ReadonlyMap<number, T> = new Map(),
  limit = MAX_HYDRATED_PAYLOADS,
): Map<number, T> {
  const result = new Map<number, T>();
  if (limit < 1) return result;

  for (const id of uniqueHydrationIds(requestedIds)) {
    const value = incoming.get(id) ?? current.get(id);
    if (value !== undefined) result.set(id, value);
    if (result.size >= limit) break;
  }

  return result;
}
