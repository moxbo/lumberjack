/**
 * Hook for managing log entry selection state
 */
import { useState, useRef, useCallback, useMemo } from "preact/hooks";

interface UseSelectionOptions {
  filteredIdx: number[];
  entries: any[];
  scrollToIndexCenter: (viIndex: number) => void;
}

export function useSelection({
  filteredIdx,
  entries,
  scrollToIndexCenter,
}: UseSelectionOptions) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);

  const toggleSelectIndex = useCallback(
    (idx: number, shift: boolean, meta: boolean) => {
      setSelected((prev) => {
        let next = new Set(prev);
        if (shift && lastClicked.current != null) {
          const a = filteredIdx.indexOf(lastClicked.current);
          const b = filteredIdx.indexOf(idx);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            next = new Set(filteredIdx.slice(lo, hi + 1).map((i) => i));
          } else {
            next = new Set([idx]);
          }
        } else if (meta) {
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
        } else {
          next = new Set([idx]);
        }
        lastClicked.current = idx;
        return next;
      });
    },
    [filteredIdx],
  );

  const moveSelectionBy = useCallback(
    (dir: 1 | -1, extend: boolean) => {
      if (!filteredIdx.length) return;

      const curGlobal =
        selected.size > 0 ? Array.from(selected).pop()! : lastClicked.current;
      const curVi = curGlobal != null ? filteredIdx.indexOf(curGlobal) : -1;

      let targetVi =
        curVi < 0 ? (dir > 0 ? 0 : filteredIdx.length - 1) : curVi + dir;
      if (targetVi < 0) targetVi = 0;
      if (targetVi > filteredIdx.length - 1) targetVi = filteredIdx.length - 1;

      const targetGlobal = filteredIdx[targetVi]!;
      if (!extend) {
        setSelected(new Set([targetGlobal]));
        lastClicked.current = targetGlobal;
      } else {
        const anchorGlobal =
          lastClicked.current != null
            ? lastClicked.current
            : (curGlobal ?? targetGlobal);
        const a = filteredIdx.indexOf(anchorGlobal);
        const b = targetVi;
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelected(new Set(filteredIdx.slice(lo, hi + 1)));
        } else {
          setSelected(new Set([targetGlobal]));
        }
      }
      scrollToIndexCenter(targetVi);
    },
    [filteredIdx, selected, scrollToIndexCenter],
  );

  const gotoListStart = useCallback(() => {
    if (!filteredIdx.length) return;
    const targetVi = 0;
    const globalIdx = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    scrollToIndexCenter(targetVi);
  }, [filteredIdx, scrollToIndexCenter]);

  const gotoListEnd = useCallback(() => {
    if (!filteredIdx.length) return;
    const targetVi = filteredIdx.length - 1;
    const globalIdx = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    scrollToIndexCenter(targetVi);
  }, [filteredIdx, scrollToIndexCenter]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedOneIdx = useMemo(() => {
    if (selected.size === 1) return Array.from(selected)[0] as number;
    if (selected.size > 1)
      return (
        lastClicked.current ?? (Array.from(selected).slice(-1)[0] as number)
      );
    return null;
  }, [selected]);

  const selectedEntry = useMemo(
    () => (selectedOneIdx != null ? entries[selectedOneIdx] || null : null),
    [selectedOneIdx, entries],
  );

  return {
    selected,
    setSelected,
    lastClicked,
    selectedOneIdx,
    selectedEntry,
    toggleSelectIndex,
    moveSelectionBy,
    gotoListStart,
    gotoListEnd,
    clearSelection,
  };
}
