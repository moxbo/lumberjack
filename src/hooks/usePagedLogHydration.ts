import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { CanonicalLogEntry, PagedLogRepository } from "../store/paged";
import {
  MAX_HYDRATED_PAYLOADS,
  pruneHydratedPayloads,
  uniqueHydrationIds,
} from "./pageHydration";

export type LogPayloadRepository = Pick<PagedLogRepository, "getPayloads">;

export function usePagedLogHydration(
  repository: LogPayloadRepository | undefined,
  requestedIds: readonly number[],
  sourceGeneration: unknown,
  onError?: (error: unknown) => void,
): ReadonlyMap<number, CanonicalLogEntry> {
  const [payloads, setPayloads] = useState<Map<number, CanonicalLogEntry>>(
    () => new Map(),
  );
  const payloadsRef = useRef(payloads);
  const desiredIdsRef = useRef<ReadonlySet<number>>(new Set());
  const inFlightRef = useRef(new Map<number, number>());
  const generationRef = useRef(0);
  const requestTokenRef = useRef(0);

  const hydrationIds = useMemo(
    () => uniqueHydrationIds(requestedIds),
    [requestedIds],
  );
  const hydrationKey = hydrationIds.join(",");

  useLayoutEffect(() => {
    generationRef.current++;
    desiredIdsRef.current = new Set();
    inFlightRef.current.clear();
    const empty = new Map<number, CanonicalLogEntry>();
    payloadsRef.current = empty;
    setPayloads(empty);
  }, [repository, sourceGeneration]);

  useEffect(() => {
    if (!repository) return;

    const desiredIds = hydrationIds.slice(0, MAX_HYDRATED_PAYLOADS);
    desiredIdsRef.current = new Set(desiredIds);

    const retained = pruneHydratedPayloads(
      payloadsRef.current,
      desiredIds,
      undefined,
      MAX_HYDRATED_PAYLOADS,
    );
    if (
      retained.size !== payloadsRef.current.size ||
      [...retained].some(([id, entry]) => payloadsRef.current.get(id) !== entry)
    ) {
      payloadsRef.current = retained;
      setPayloads(retained);
    }

    const missingIds = desiredIds.filter(
      (id) => !payloadsRef.current.has(id) && !inFlightRef.current.has(id),
    );
    if (missingIds.length === 0) return;

    const generation = generationRef.current;
    const requestToken = ++requestTokenRef.current;
    for (const id of missingIds) inFlightRef.current.set(id, requestToken);

    void repository
      .getPayloads(missingIds)
      .then((incoming) => {
        if (generationRef.current !== generation) return;
        const currentDesiredIds = [...desiredIdsRef.current];
        const next = pruneHydratedPayloads(
          payloadsRef.current,
          currentDesiredIds,
          incoming,
          MAX_HYDRATED_PAYLOADS,
        );
        payloadsRef.current = next;
        setPayloads(next);
      })
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        for (const id of missingIds) {
          if (inFlightRef.current.get(id) === requestToken) {
            inFlightRef.current.delete(id);
          }
        }
      });
  }, [repository, sourceGeneration, hydrationKey, onError]);

  return payloads;
}
