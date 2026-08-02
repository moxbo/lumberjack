import type { ComponentChildren } from "preact";
import { forwardRef } from "preact/compat";
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type LogPayloadRepository,
  usePagedLogHydration,
} from "../../hooks/usePagedLogHydration";
import { entrySignature } from "../../utils/entryUtils";
import logger from "../../utils/logger";
import { LogRow } from "../LogRow";

const ROW_HEIGHT = 36;

type ScrollAlign = "auto" | "center" | "end" | "start";

export interface VirtualizedLogListHandle {
  scrollToIndex: (index: number, align?: ScrollAlign) => void;
  scrollToIndexCenter: (index: number) => void;
  scrollAfterFilterChange: (index: number) => void;
}

export interface VirtualizedLogListProps {
  entries?: readonly object[];
  repository?: LogPayloadRepository;
  filteredIdx: number[];
  selected: Set<number>;
  marksMap: Record<string, string>;
  search: string;
  follow: boolean;
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

export const VirtualizedLogList = forwardRef<
  VirtualizedLogListHandle,
  VirtualizedLogListProps
>(function VirtualizedLogList(
  {
    entries = [],
    repository,
    filteredIdx,
    selected,
    marksMap,
    search,
    follow,
    listRef,
    onDisableFollow,
    onKeyDown,
    onRowSelect,
    onRowContextMenu,
    onColMouseDown,
    highlightFn,
    t,
    children,
  },
  ref,
) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [, forceUpdate] = useState(0);
  const isProgrammaticScrollRef = useRef(false);

  const setListElement = useCallback(
    (element: HTMLDivElement | null) => {
      listRef.current = element;
      setScrollElement(element);
    },
    [listRef],
  );

  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const estimateSize = useCallback(() => ROW_HEIGHT, []);
  const getItemKey = useCallback(
    (index: number) => {
      const globalIdx = filteredIdx[index];
      return globalIdx !== undefined ? `row-${globalIdx}` : `row-temp-${index}`;
    },
    [filteredIdx],
  );

  const dynamicOverscan =
    filteredIdx.length > 100000 ? 25 : filteredIdx.length > 50000 ? 20 : 15;

  const virtualizer = useVirtualizer({
    count: scrollElement ? filteredIdx.length : 0,
    getScrollElement,
    estimateSize,
    overscan: dynamicOverscan,
    getItemKey,
    measureElement: undefined,
  } as any);

  const handleScroll = useCallback(
    (event: Event) => {
      if (isProgrammaticScrollRef.current || !follow) return;

      const target = event.target as HTMLElement;
      if (!target) return;
      const distanceFromBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceFromBottom > 100) onDisableFollow();
    },
    [follow, onDisableFollow],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = "auto") {
        virtualizer.scrollToIndex(index, { align });
      },
      scrollToIndexCenter(index) {
        isProgrammaticScrollRef.current = true;
        virtualizer.scrollToIndex(index, { align: "auto" });

        requestAnimationFrame(() => {
          const rowElement = scrollElement?.querySelector(
            `[data-vi="${index}"]`,
          ) as HTMLElement | null;
          if (rowElement) {
            rowElement.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 300);
        });
      },
      scrollAfterFilterChange(index) {
        isProgrammaticScrollRef.current = true;
        setTimeout(() => {
          virtualizer.scrollToIndex(index, { align: "start" });
          requestAnimationFrame(() => {
            forceUpdate((value) => value + 1);
            setTimeout(() => {
              isProgrammaticScrollRef.current = false;
            }, 300);
          });
        }, 0);
      },
    }),
    [scrollElement, virtualizer],
  );

  const virtualItems = scrollElement ? virtualizer.getVirtualItems() : [];
  const totalHeight = scrollElement ? virtualizer.getTotalSize() : 0;
  const requestedPayloadIds = useMemo(
    () =>
      repository
        ? virtualItems
            .map((virtualItem) => filteredIdx[virtualItem.index])
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
      aria-label={t("list.ariaLabel")}
      onKeyDown={onKeyDown as any}
      onScroll={handleScroll as any}
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

          const globalIdx = filteredIdx[visualIndex]!;
          const entry = repository
            ? hydratedPayloads.get(globalIdx)
            : (entries[globalIdx] as Record<string, unknown> | undefined);
          if (!entry) {
            return (
              <div
                key={virtualItem.key}
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
            marksMap[entrySignature(entry)] ||
            (typeof entry._mark === "string" ? entry._mark : undefined) ||
            (typeof entry.color === "string" ? entry.color : undefined);

          return (
            <LogRow
              key={virtualItem.key}
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
