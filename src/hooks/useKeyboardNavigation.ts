/**
 * Hook for keyboard navigation in the log list
 */
import { useCallback, useEffect } from "preact/hooks";
import logger from "../utils/logger";

interface UseKeyboardNavigationOptions {
  filteredIdx: number[];
  searchMatchIdx: number[];
  markedIdx: number[];
  selectedOneIdx: number | null;
  search: string;
  showHelpDlg: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  parentRef: React.RefObject<HTMLDivElement>;

  // Actions
  moveSelectionBy: (dir: 1 | -1, extend: boolean) => void;
  gotoListStart: () => void;
  gotoListEnd: () => void;
  clearSelection: () => void;
  setSearch: (s: string) => void;
  setFiltersExpanded: (fn: (prev: boolean) => boolean) => void;
  setShowHelpDlg: (show: boolean) => void;
  scrollToIndexCenter: (viIndex: number) => void;
  setSelected: (fn: (prev: Set<number>) => Set<number>) => void;
  lastClicked: React.MutableRefObject<number | null>;
}

export function useKeyboardNavigation({
  filteredIdx,
  searchMatchIdx,
  markedIdx,
  selectedOneIdx,
  search,
  showHelpDlg,
  searchInputRef,
  parentRef,
  moveSelectionBy,
  gotoListStart,
  gotoListEnd,
  clearSelection,
  setSearch,
  setFiltersExpanded,
  setShowHelpDlg,
  scrollToIndexCenter,
  setSelected,
  lastClicked,
}: UseKeyboardNavigationOptions) {
  // Navigate to marked entry
  const gotoMarked = useCallback(
    (dir: number) => {
      if (!markedIdx.length) return;
      const curVi =
        selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
      const first = markedIdx[0]!;
      const last = markedIdx[markedIdx.length - 1]!;
      let targetVi: number | undefined;

      if (dir > 0) {
        if (curVi < 0) targetVi = first;
        else {
          const next = markedIdx.find((vi) => vi > curVi);
          targetVi = next != null ? next : last;
        }
      } else {
        if (curVi < 0) targetVi = last;
        else {
          let prev = -1;
          for (const vi of markedIdx) if (vi < curVi) prev = vi;
          targetVi = prev >= 0 ? prev : first;
        }
      }

      const globalIdx: number = filteredIdx[targetVi!]!;
      setSelected(() => new Set([globalIdx]));
      lastClicked.current = globalIdx;
      scrollToIndexCenter(targetVi!);
    },
    [
      markedIdx,
      selectedOneIdx,
      filteredIdx,
      scrollToIndexCenter,
      setSelected,
      lastClicked,
    ],
  );

  // Navigate to search match
  const gotoSearchMatch = useCallback(
    (dir: number) => {
      if (!searchMatchIdx.length) return;
      const curVi =
        selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
      const first = searchMatchIdx[0]!;
      const last = searchMatchIdx[searchMatchIdx.length - 1]!;
      let targetVi: number | undefined;

      if (dir > 0) {
        if (curVi < 0) targetVi = first;
        else {
          const next = searchMatchIdx.find((vi) => vi > curVi);
          targetVi = next != null ? next : last;
        }
      } else {
        if (curVi < 0) targetVi = last;
        else {
          let prev = -1;
          for (const vi of searchMatchIdx) if (vi < curVi) prev = vi;
          targetVi = prev >= 0 ? prev : first;
        }
      }

      const globalIdx: number = filteredIdx[targetVi!]!;
      setSelected(() => new Set([globalIdx]));
      lastClicked.current = globalIdx;
      scrollToIndexCenter(targetVi!);
    },
    [
      searchMatchIdx,
      selectedOneIdx,
      filteredIdx,
      scrollToIndexCenter,
      setSelected,
      lastClicked,
    ],
  );

  // List key handler
  const onListKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!filteredIdx.length) return;

      try {
        // Standard Arrow Keys
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelectionBy(1, !!(e as any).shiftKey);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelectionBy(-1, !!(e as any).shiftKey);
        }
        // Vim-Style Navigation
        else if (e.key === "j" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          moveSelectionBy(1, !!(e as any).shiftKey);
        } else if (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          moveSelectionBy(-1, !!(e as any).shiftKey);
        }
        // g = go to start
        else if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          gotoListStart();
        }
        // G = go to end
        else if (e.key === "G" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          gotoListEnd();
        } else if (e.key === "End") {
          e.preventDefault();
          gotoListEnd();
        } else if (e.key === "Home") {
          e.preventDefault();
          gotoListStart();
        } else if (e.key === "Escape") {
          e.preventDefault();
          clearSelection();
        }
        // n = next search match
        else if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          gotoSearchMatch(1);
        }
        // N = previous search match
        else if (e.key === "N" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          gotoSearchMatch(-1);
        }
      } catch (err) {
        logger.warn("Error in onListKeyDown:", err);
      }
    },
    [
      filteredIdx,
      moveSelectionBy,
      gotoListStart,
      gotoListEnd,
      clearSelection,
      gotoSearchMatch,
    ],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+F = focus search
      if (cmdOrCtrl && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // Cmd/Ctrl+Shift+F = toggle filter section
      else if (cmdOrCtrl && e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault();
        setFiltersExpanded((prev) => !prev);
      }
      // Escape in search = clear and focus list
      else if (
        e.key === "Escape" &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault();
        if (search) {
          setSearch("");
        } else {
          try {
            (parentRef.current as any)?.focus?.();
          } catch {}
        }
      }
      // Escape with help dialog open
      else if (e.key === "Escape" && showHelpDlg) {
        e.preventDefault();
        setShowHelpDlg(false);
      }
      // F1 = open help
      else if (e.key === "F1") {
        e.preventDefault();
        setShowHelpDlg(true);
      }
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [
    search,
    showHelpDlg,
    searchInputRef,
    parentRef,
    setSearch,
    setFiltersExpanded,
    setShowHelpDlg,
  ]);

  return {
    onListKeyDown,
    gotoMarked,
    gotoSearchMatch,
  };
}
