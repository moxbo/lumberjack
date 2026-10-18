import type { ComponentChildren, Ref } from "preact";
import { memo } from "preact/compat";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { useFixedRowVirtualizer } from "../../hooks/useFixedRowVirtualizer";
import type { ScrollAlign } from "../../hooks/fixedRowScroll";
import {
  type LogPayloadRepository,
  usePagedLogHydration,
} from "../../hooks/usePagedLogHydration";
import logger from "../../utils/logger";
import type { ReadonlySequence } from "../../utils/metadataSnapshot";
import { LogRow } from "../LogRow";
import { anchoredScrollOffset } from "../progressiveSearch";

const ROW_HEIGHT = 36;

export interface VirtualizedLogListHandle {
  scrollToIndex: (index: number, align?: ScrollAlign) => void;
  scrollToIndexCenter: (index: number) => void;
  scrollAfterFilterChange: (index: number) => void;
}

export interface VirtualizedLogListProps {
  ref?: Ref<VirtualizedLogListHandle>;
  entries?: ReadonlySequence<object>;
  repository?: LogPayloadRepository;
  filteredIdx: ReadonlySequence<number>;
  selected: Set<number>;
  marksMap: Record<string, string>;
  search: string;
  follow: boolean;
  queryKey?: string;
  positionOfId?: (id: number) => number;
  onUserInteraction?: () => void;
  listRef: { current: HTMLDivElement | null };
  onDisableFollow: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onRowSelect: (index: number, shift: boolean, meta: boolean) => void;
  onRowContextMenu: (event: MouseEvent, index: number) => void;
  onColMouseDown: (key: "ts" | "lvl" | "logger", event: MouseEvent) => void;
  highlightFn: (text: string, search: string) => string;
  t: (key: string, params?: Record<string, string>) => string;
  children?: ComponentChildren;
}

export const VirtualizedLogList = memo(function VirtualizedLogList({
  ref = null,
  entries = [],
  repository,
  filteredIdx,
  selected,
  marksMap,
  search,
  follow,
  queryKey,
  positionOfId,
  onUserInteraction,
  listRef,
  onDisableFollow,
  onKeyDown,
  onRowSelect,
  onRowContextMenu,
  onColMouseDown,
  highlightFn,
  t,
  children,
}: VirtualizedLogListProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const isProgrammaticScrollRef = useRef(false);
  const interactionVersion = useRef(0);
  const currentView = useRef({ filteredIdx, positionOfId, queryKey });
  currentView.current = { filteredIdx, positionOfId, queryKey };
  const handleUserInteraction = useCallback(() => {
    interactionVersion.current++;
    isProgrammaticScrollRef.current = false;
    onUserInteraction?.();
  }, [onUserInteraction]);

  const setListElement = useCallback(
    (element: HTMLDivElement | null) => {
      listRef.current = element;
      setScrollElement(element);
    },
    [listRef],
  );

  const dynamicOverscan =
    filteredIdx.length > 100000 ? 8 : filteredIdx.length > 50000 ? 10 : 15;

  const virtualizer = useFixedRowVirtualizer(
    scrollElement,
    filteredIdx.length,
    ROW_HEIGHT,
    dynamicOverscan,
  );
  const currentVirtualizer = useRef(virtualizer);
  currentVirtualizer.current = virtualizer;
  const previousList = useRef({
    ids: filteredIdx,
    queryKey,
    getScrollOffset: virtualizer.getScrollOffset,
    height: virtualizer.viewportHeight,
  });
  useLayoutEffect(() => {
    const previous = previousList.current;
    previousList.current = {
      ids: filteredIdx,
      queryKey,
      getScrollOffset: virtualizer.getScrollOffset,
      height: virtualizer.viewportHeight,
    };
    if (
      !scrollElement ||
      (previous.ids === filteredIdx &&
        previous.height === virtualizer.viewportHeight) ||
      previous.queryKey !== queryKey
    )
      return;
    const offset = anchoredScrollOffset(
      previous.ids,
      previous.getScrollOffset(),
      positionOfId ?? ((id) => filteredIdx.indexOf(id)),
      ROW_HEIGHT,
    );
    if (offset !== null && offset !== virtualizer.getScrollOffset()) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToOffset(offset);
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [filteredIdx, queryKey, positionOfId, scrollElement, virtualizer]);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current || !follow) return;
    if (virtualizer.getDistanceFromEnd() > 100) onDisableFollow();
  }, [follow, onDisableFollow, virtualizer]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = "auto") {
        virtualizer.scrollToIndex(index, { align });
      },
      scrollToIndexCenter(index) {
        const id = currentView.current.filteredIdx.at(index);
        const query = currentView.current.queryKey;
        const interaction = interactionVersion.current;
        isProgrammaticScrollRef.current = true;
        virtualizer.scrollToIndex(index, { align: "auto" });

        requestAnimationFrame(() => {
          if (
            query !== currentView.current.queryKey ||
            interaction !== interactionVersion.current ||
            id === undefined
          ) {
            isProgrammaticScrollRef.current = false;
            return;
          }
          const currentIndex =
            currentView.current.positionOfId?.(id) ??
            currentView.current.filteredIdx.indexOf(id);
          if (currentIndex >= 0)
            currentVirtualizer.current.scrollToIndex(currentIndex, {
              align: "auto",
            });
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 300);
        });
      },
      scrollAfterFilterChange(index) {
        const id = currentView.current.filteredIdx.at(index);
        const query = currentView.current.queryKey;
        const interaction = interactionVersion.current;
        isProgrammaticScrollRef.current = true;
        requestAnimationFrame(() => {
          if (
            query !== currentView.current.queryKey ||
            interaction !== interactionVersion.current ||
            id === undefined
          ) {
            isProgrammaticScrollRef.current = false;
            return;
          }
          const currentIndex =
            currentView.current.positionOfId?.(id) ??
            currentView.current.filteredIdx.indexOf(id);
          if (currentIndex >= 0)
            currentVirtualizer.current.scrollToIndex(currentIndex, {
              align: "center",
            });
          requestAnimationFrame(() => {
            isProgrammaticScrollRef.current = false;
          });
        });
      },
    }),
    [scrollElement, virtualizer],
  );

  const { virtualItems, totalHeight } = virtualizer;
  const requestedPayloadIds = useMemo(
    () =>
      repository
        ? virtualItems
            .map((virtualItem) => filteredIdx.at(virtualItem.index))
            .filter((id): id is number => id !== undefined)
        : [],
    [filteredIdx, repository, virtualItems],
  );
  const handleHydrationError = useCallback(
    (error: unknown) => logger.error("Loading visible log rows failed:", error),
    [],
  );
  const hydratedPayloads = usePagedLogHydration(
    repository,
    requestedPayloadIds,
    repository,
    handleHydrationError,
  );

  return (
    <div
      className="list"
      ref={setListElement}
      tabIndex={0}
      role="listbox"
      style={{ overflowAnchor: "none" }}
      aria-label={t("list.ariaLabel")}
      onKeyDown={(event) => {
        handleUserInteraction();
        onKeyDown(event as any);
      }}
      onWheel={handleUserInteraction}
      onTouchStart={handleUserInteraction}
      onPointerDown={handleUserInteraction}
      onScroll={handleScroll}
      onMouseDown={(event) => {
        try {
          if (listRef.current && !event.defaultPrevented) {
            listRef.current.focus({ preventScroll: true });
          }
        } catch (error) {
          logger.warn("onMouseDown focus set failed:", error);
        }
      }}
    >
      <div className="list-header">
        <div className="cell">
          {t("list.header.timestamp")}
          <div
            className="resizer"
            onMouseDown={(event) => onColMouseDown("ts", event as MouseEvent)}
          />
        </div>
        <div className="cell cell--center">
          {t("list.header.level")}
          <div
            className="resizer"
            onMouseDown={(event) => onColMouseDown("lvl", event as MouseEvent)}
          />
        </div>
        <div className="cell">
          {t("list.header.logger")}
          <div
            className="resizer"
            onMouseDown={(event) =>
              onColMouseDown("logger", event as MouseEvent)
            }
          />
        </div>
        <div className="cell">{t("list.header.message")}</div>
      </div>

      <div
        style={{
          height: totalHeight + "px",
          position: "relative",
          pointerEvents: "auto",
          contain: "strict",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const visualIndex = virtualItem.index;
          if (visualIndex < 0 || visualIndex >= filteredIdx.length) return null;

          const globalIdx = filteredIdx.at(visualIndex)!;
          const entry = repository
            ? hydratedPayloads.get(globalIdx)
            : (entries.at(globalIdx) as Record<string, unknown> | undefined);
          if (!entry) {
            return (
              <div
                key={`row-${globalIdx}`}
                className="row row--placeholder"
                role="presentation"
                aria-hidden="true"
                data-vi={visualIndex}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${ROW_HEIGHT}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  pointerEvents: "none",
                }}
              />
            );
          }

          const payloadSignature =
            typeof entry.signature === "string" ? entry.signature : undefined;
          const markColor =
            (payloadSignature ? marksMap[payloadSignature] : undefined) ||
            (typeof entry._mark === "string" ? entry._mark : undefined) ||
            (typeof entry.color === "string" ? entry.color : undefined);

          return (
            <LogRow
              key={`row-${globalIdx}`}
              index={visualIndex}
              globalIdx={globalIdx}
              entry={entry}
              isSelected={selected.has(globalIdx)}
              rowHeight={ROW_HEIGHT}
              yOffset={virtualItem.start}
              markColor={markColor}
              search={search}
              onSelect={onRowSelect}
              onContextMenu={onRowContextMenu}
              highlightFn={highlightFn}
              t={t}
            />
          );
        })}
      </div>

      {children}
    </div>
  );
});
