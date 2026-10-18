import { createRef, render } from "preact";
import {
  VirtualizedLogList,
  type VirtualizedLogListHandle,
} from "../../../src/renderer/components/VirtualizedLogList";
import type { LogPayloadRepository } from "../../../src/hooks/usePagedLogHydration";

let handle = createRef<VirtualizedLogListHandle>();
const listRef = { current: null as HTMLDivElement | null };
let ids: number[] = [];
let firstId = 0;
let selected = new Set<number>();
let queryKey = "all";
let root: HTMLDivElement;
export let largestPayloadRequest = 0;
export let followEnabled = false;
const repository: LogPayloadRepository = {
  async getPayloads(requested) {
    largestPayloadRequest = Math.max(largestPayloadRequest, requested.length);
    return new Map(
      requested.map((id) => [
        id,
        {
          _id: id,
          timestamp: 1_700_000_000_000 + id,
          level: "INFO",
          message: `row-${id}`,
          source: "synthetic",
        },
      ]),
    );
  },
};
const noop = () => {};

function draw() {
  render(
    <VirtualizedLogList
      ref={handle}
      repository={repository}
      filteredIdx={ids}
      positionOfId={(id) =>
        id >= firstId && id < firstId + ids.length ? id - firstId : -1
      }
      selected={selected}
      marksMap={{}}
      search=""
      follow={followEnabled}
      queryKey={queryKey}
      listRef={listRef}
      onDisableFollow={() => {
        followEnabled = false;
        draw();
      }}
      onKeyDown={noop}
      onRowSelect={(id) => {
        selected = new Set([id]);
        draw();
      }}
      onRowContextMenu={noop}
      onColMouseDown={noop}
      highlightFn={(text) => text}
      t={(key) => key}
    />,
    root,
  );
}

export function setRows(count: number, start = 1, query = queryKey) {
  firstId = start;
  queryKey = query;
  ids = Array.from({ length: count }, (_, index) => start + index);
  draw();
}

export function navigate(
  index: number,
  align: "auto" | "center" | "end" | "start" = "auto",
) {
  handle.current!.scrollToIndex(index, align);
}

export function selectAndNavigate(index: number) {
  selected = new Set([ids[index]!]);
  draw();
  handle.current!.scrollToIndexCenter(index);
}

export function restoreSelection() {
  const id = [...selected][0]!;
  handle.current!.scrollAfterFilterChange(id - firstId);
}

export function setFollow(enabled: boolean) {
  followEnabled = enabled;
  draw();
}

export function resize(height: number) {
  root.style.height = `${height}px`;
}

export function replaceHandle() {
  const previous = handle;
  handle = createRef<VirtualizedLogListHandle>();
  draw();
  return {
    previousCleared: previous.current === null,
    attached: handle.current !== null,
  };
}

export function unmount() {
  render(null, root);
  root.remove();
  return {
    handleCleared: handle.current === null,
    listCleared: listRef.current === null,
  };
}

export function mount() {
  root = document.createElement("div");
  root.id = "large-log-list-fixture";
  root.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;background:white";
  document.body.append(root);
  setRows(1_772_245);
}
