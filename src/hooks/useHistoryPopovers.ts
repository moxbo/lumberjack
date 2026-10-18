/**
 * Hook for managing popover state and positions
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

interface UseHistoryPopoversReturn {
  // Search history
  showSearchHist: boolean;
  setShowSearchHist: (show: boolean) => void;
  searchHistHighlightIdx: number;
  setSearchHistHighlightIdx: (idx: number) => void;
  searchPos: PopoverPosition | null;
  searchHistRef: RefObject<HTMLDivElement | null>;
  searchPopRef: RefObject<HTMLDivElement | null>;

  // Logger history
  showLoggerHist: boolean;
  setShowLoggerHist: (show: boolean) => void;
  loggerPos: PopoverPosition | null;
  loggerHistRef: RefObject<HTMLDivElement | null>;
  loggerPopRef: RefObject<HTMLDivElement | null>;

  // Thread history
  showThreadHist: boolean;
  setShowThreadHist: (show: boolean) => void;
  threadPos: PopoverPosition | null;
  threadHistRef: RefObject<HTMLDivElement | null>;
  threadPopRef: RefObject<HTMLDivElement | null>;

  // Message history
  showMessageHist: boolean;
  setShowMessageHist: (show: boolean) => void;
  messagePos: PopoverPosition | null;
  messageHistRef: RefObject<HTMLDivElement | null>;
  messagePopRef: RefObject<HTMLDivElement | null>;

  // Actions
  closeAllHistoryPopovers: () => void;

  // Search input ref
  searchInputRef: RefObject<HTMLInputElement | null>;
}

function computePosFor(el: HTMLElement | null): PopoverPosition | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    top: Math.round(r.bottom + 2),
    width: Math.round(r.width),
  };
}

export function useHistoryPopovers(): UseHistoryPopoversReturn {
  // Search history state
  const [showSearchHist, setShowSearchHist] = useState<boolean>(false);
  const [searchHistHighlightIdx, setSearchHistHighlightIdx] =
    useState<number>(-1);
  const [searchPos, setSearchPos] = useState<PopoverPosition | null>(null);

  // Logger history state
  const [showLoggerHist, setShowLoggerHist] = useState<boolean>(false);
  const [loggerPos, setLoggerPos] = useState<PopoverPosition | null>(null);

  // Thread history state
  const [showThreadHist, setShowThreadHist] = useState<boolean>(false);
  const [threadPos, setThreadPos] = useState<PopoverPosition | null>(null);

  // Message history state
  const [showMessageHist, setShowMessageHist] = useState<boolean>(false);
  const [messagePos, setMessagePos] = useState<PopoverPosition | null>(null);

  // Refs
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchHistRef = useRef<HTMLDivElement | null>(null);
  const searchPopRef = useRef<HTMLDivElement | null>(null);
  const loggerHistRef = useRef<HTMLDivElement | null>(null);
  const loggerPopRef = useRef<HTMLDivElement | null>(null);
  const threadHistRef = useRef<HTMLDivElement | null>(null);
  const threadPopRef = useRef<HTMLDivElement | null>(null);
  const messageHistRef = useRef<HTMLDivElement | null>(null);
  const messagePopRef = useRef<HTMLDivElement | null>(null);

  // Update positions
  const updateVisiblePopoverPositions = useCallback(() => {
    if (showSearchHist) setSearchPos(computePosFor(searchInputRef.current));
    if (showLoggerHist) setLoggerPos(computePosFor(loggerHistRef.current));
    if (showThreadHist) setThreadPos(computePosFor(threadHistRef.current));
    if (showMessageHist) setMessagePos(computePosFor(messageHistRef.current));
  }, [showSearchHist, showLoggerHist, showThreadHist, showMessageHist]);

  // Update positions when popovers open
  useEffect(() => {
    updateVisiblePopoverPositions();
  }, [updateVisiblePopoverPositions]);

  // Handle resize and scroll
  useEffect(() => {
    if (
      !showSearchHist &&
      !showLoggerHist &&
      !showThreadHist &&
      !showMessageHist
    ) {
      return;
    }

    const onResize = (): void => updateVisiblePopoverPositions();
    const onScroll = (): void => updateVisiblePopoverPositions();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [
    showSearchHist,
    showLoggerHist,
    showThreadHist,
    showMessageHist,
    updateVisiblePopoverPositions,
  ]);

  // Close all popovers (note: showSearchOptions is managed by useFilterState)
  const closeAllHistoryPopovers = useCallback(() => {
    setShowSearchHist(false);
    setShowLoggerHist(false);
    setShowThreadHist(false);
    setShowMessageHist(false);
  }, []);

  // Handle outside clicks
  useEffect(() => {
    if (
      !showSearchHist &&
      !showLoggerHist &&
      !showThreadHist &&
      !showMessageHist
    ) {
      return;
    }

    const onDocDown = (ev: MouseEvent): void => {
      try {
        const t = ev.target as Node;
        if (
          (searchHistRef.current && searchHistRef.current.contains(t)) ||
          (loggerHistRef.current && loggerHistRef.current.contains(t)) ||
          (threadHistRef.current && threadHistRef.current.contains(t)) ||
          (messageHistRef.current && messageHistRef.current.contains(t)) ||
          (searchPopRef.current && searchPopRef.current.contains(t)) ||
          (loggerPopRef.current && loggerPopRef.current.contains(t)) ||
          (threadPopRef.current && threadPopRef.current.contains(t)) ||
          (messagePopRef.current && messagePopRef.current.contains(t))
        ) {
          return; // Click inside a wrapper - don't close
        }
      } catch {
        // Ignore errors
      }
      closeAllHistoryPopovers();
    };

    window.addEventListener("mousedown", onDocDown, true);
    return () => window.removeEventListener("mousedown", onDocDown, true);
  }, [
    showSearchHist,
    showLoggerHist,
    showThreadHist,
    showMessageHist,
    closeAllHistoryPopovers,
  ]);

  return {
    showSearchHist,
    setShowSearchHist,
    searchHistHighlightIdx,
    setSearchHistHighlightIdx,
    searchPos,
    searchHistRef,
    searchPopRef,

    showLoggerHist,
    setShowLoggerHist,
    loggerPos,
    loggerHistRef,
    loggerPopRef,

    showThreadHist,
    setShowThreadHist,
    threadPos,
    threadHistRef,
    threadPopRef,

    showMessageHist,
    setShowMessageHist,
    messagePos,
    messageHistRef,
    messagePopRef,

    closeAllHistoryPopovers,
    searchInputRef,
  };
}
