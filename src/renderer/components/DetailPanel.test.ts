import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRawPreview,
  DetailPanelComponent,
  type DetailPanelProps,
} from "./DetailPanel";
import type { HeavyRecord } from "../../store/heavyFieldStore";
import { useHighlightedHtml } from "../../hooks/useHighlightedHtml";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as Array<{
    value?: unknown;
    deps?: unknown[];
    cleanup?: () => void;
  }>,
  effects: [] as Array<() => void>,
  getHeavy: vi.fn<(id: number) => Promise<HeavyRecord | undefined>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
  logError: vi.fn(),
  comparator: undefined as
    ((prev: DetailPanelProps, next: DetailPanelProps) => boolean) | undefined,
}));

vi.mock("preact/compat", () => ({
  memo: (
    component: unknown,
    comparator: (prev: DetailPanelProps, next: DetailPanelProps) => boolean,
  ) => {
    hooks.comparator = comparator;
    return component;
  },
}));
vi.mock("preact/hooks", () => ({
  useId: () => "inspector-test",
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    const slot = (hooks.slots[index] ??= { value: { current: initial } });
    return slot.value;
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    const slot = (hooks.slots[index] ??= { value: initial });
    return [slot.value, (value: unknown) => (slot.value = value)];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const slot = (hooks.slots[index] ??= {});
    if (!slot.deps || deps.some((dep, i) => dep !== slot.deps![i])) {
      slot.deps = deps;
      hooks.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect();
      });
    }
  },
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++;
    const slot = (hooks.slots[index] ??= {});
    if (!slot.deps || deps.some((dep, i) => dep !== slot.deps![i])) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  },
}));
vi.mock("../../utils/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/useHighlightedHtml", () => ({
  useHighlightedHtml: vi.fn((message: string) => message),
}));
vi.mock("../../store/heavyFieldStore", () => ({
  heavyFieldStore: { get: hooks.getHeavy },
}));
vi.mock("../../utils/logger", () => ({
  default: { error: hooks.logError },
}));

type TestNode = { props: Record<string, unknown> };

function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as TestNode;
  return [node, ...nodes(node.props.children)];
}

function find(tree: unknown, key: string, value: unknown): TestNode {
  const node = nodes(tree).find((node) => node.props[key] === value);
  expect(node, `${key}=${String(value)}`).toBeDefined();
  return node!;
}

function text(tree: unknown): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree && typeof tree === "object" && "props" in tree)
    return text((tree as TestNode).props.children);
  return "";
}

function click(node: TestNode) {
  (node.props.onClick as () => void)();
}

function render(props: DetailPanelProps) {
  hooks.cursor = 0;
  const tree = DetailPanelComponent(props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}

function toggleRaw(tree: unknown, open: boolean) {
  const details = find(tree, "className", "inspector-raw");
  (details.props.onToggle as (event: unknown) => void)({
    currentTarget: { open },
  });
}

function props(overrides: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
    selectedEntry: {
      _id: 7,
      timestamp: "2026-09-14T10:34:25.128Z",
      level: "ERROR",
      logger: "PaymentGateway",
      thread: "worker-2",
      message: "Payment timeout",
      stackTrace: "SocketTimeoutException\nat PaymentGateway",
      raw: { original: "payload" },
    },
    mdcPairs: [["traceId", "trace-123"]],
    search: "timeout",
    onAddMdcToFilter: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  hooks.slots.forEach((slot) => slot.cleanup?.());
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.clearAllMocks();
  hooks.writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    clipboard: { writeText: hooks.writeText },
  });
});

describe("DetailPanel inspector", () => {
  it("renders the selected entry, preserves highlighting and supports closing", () => {
    const options = props({ onClose: vi.fn(), markColor: "#ffcc00" });
    const tree = render(options);
    expect(text(tree)).toContain("PaymentGateway");
    expect(text(tree)).toContain("ERROR");
    expect(useHighlightedHtml).toHaveBeenCalledWith(
      "Payment timeout",
      "timeout",
    );
    expect(tree.props["data-tinted"]).toBe("1");
    click(find(tree, "aria-label", "inspector.close"));
    expect(options.onClose).toHaveBeenCalledOnce();
  });

  it("shows empty state without entry tabs or copy action", () => {
    const tree = render(props({ selectedEntry: null }));
    expect(text(tree)).toContain("details.noSelection");
    expect(nodes(tree).some((node) => node.props.role === "tab")).toBe(false);
  });

  it("switches accessible tabs and retains logger, thread and MDC filter actions", () => {
    const options = props({
      onFilterByLogger: vi.fn(),
      onFilterByThread: vi.fn(),
    });
    let tree = render(options);
    click(find(tree, "id", "inspector-test-tab-context"));
    tree = render(options);
    expect(find(tree, "role", "tabpanel").props["aria-labelledby"]).toBe(
      "inspector-test-tab-context",
    );
    expect(find(tree, "id", "inspector-test-tab-context").props.tabIndex).toBe(
      0,
    );
    expect(text(tree)).toContain("trace-123");
    click(find(tree, "aria-label", "details.filterByLogger"));
    click(find(tree, "aria-label", "details.filterByThread"));
    click(find(tree, "aria-label", "details.addToFilter: traceId"));
    expect(options.onFilterByLogger).toHaveBeenCalledWith("PaymentGateway");
    expect(options.onFilterByThread).toHaveBeenCalledWith("worker-2");
    expect(options.onAddMdcToFilter).toHaveBeenCalledWith(
      "traceId",
      "trace-123",
    );
    click(find(tree, "id", "inspector-test-tab-stacktrace"));
    expect(text(render(options))).toContain("SocketTimeoutException");
  });

  it("supports arrow keys, Home and End with roving focus", () => {
    const options = props();
    const focus = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
    for (const [key, expected] of [
      ["ArrowLeft", 3],
      ["Home", 0],
      ["End", 3],
      ["ArrowRight", 0],
    ] as const) {
      const tree = render(options);
      const active = nodes(tree).find(
        (node) => node.props["aria-selected"] === true,
      )!;
      const event = {
        key,
        preventDefault: vi.fn(),
        currentTarget: {
          parentElement: { querySelectorAll: () => focus },
        },
      };
      (active.props.onKeyDown as (event: unknown) => void)(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(focus[expected]!.focus).toHaveBeenCalled();
    }
  });

  it("does not inspect raw payload until requested, then memoizes its bounded preview", () => {
    const read = vi.fn(() => "original payload");
    const raw = Object.defineProperty({}, "original", {
      enumerable: true,
      get: read,
    });
    const options = props();
    options.selectedEntry!.raw = raw;
    let tree = render(options);
    expect(read).not.toHaveBeenCalled();
    expect(
      nodes(tree).some((node) => node.props.id === "inspector-test-tab-raw"),
    ).toBe(false);
    click(find(tree, "id", "inspector-test-tab-advanced"));
    tree = render(options);
    expect(find(tree, "className", "inspector-raw").props.open).toBe(false);
    expect(read).not.toHaveBeenCalled();
    toggleRaw(tree, true);
    tree = render(options);
    expect(read).toHaveBeenCalledOnce();
    expect(text(tree)).toContain("original payload");
    render({ ...options, search: "changed" });
    expect(read).toHaveBeenCalledOnce();
    toggleRaw(tree, false);
    tree = render(options);
    expect(text(tree)).not.toContain("original payload");
    expect(find(tree, "className", "inspector-raw").props.open).toBe(false);
  });

  it("collapses raw data again when the selected entry changes", () => {
    const options = props();
    let tree = render(options);
    click(find(tree, "id", "inspector-test-tab-advanced"));
    tree = render(options);
    toggleRaw(tree, true);
    expect(text(render(options))).toContain("payload");
    const next = props();
    tree = render(next);
    expect(find(tree, "className", "inspector-raw").props.open).toBe(false);
    expect(text(tree)).not.toContain("payload");
    expect(find(render(options), "className", "inspector-raw").props.open).toBe(
      false,
    );
  });

  it("requires full-message opt-in again after changing selection", () => {
    const options = props();
    options.selectedEntry!._truncated = true;
    options.selectedEntry!._fullMessage = "Full payment timeout";
    let tree = render(options);
    expect(useHighlightedHtml).toHaveBeenLastCalledWith(
      "Payment timeout",
      "timeout",
    );
    click(find(tree, "aria-pressed", false));
    tree = render(options);
    expect(useHighlightedHtml).toHaveBeenLastCalledWith(
      "Full payment timeout",
      "timeout",
    );
    expect(find(tree, "aria-pressed", true)).toBeDefined();
    const next = props();
    next.selectedEntry!._truncated = true;
    next.selectedEntry!._fullMessage = "Another full message";
    render(next);
    expect(useHighlightedHtml).toHaveBeenLastCalledWith(
      "Payment timeout",
      "timeout",
    );
    render(options);
    expect(useHighlightedHtml).toHaveBeenLastCalledWith(
      "Payment timeout",
      "timeout",
    );
  });

  it("loads offloaded messages, disables premature copy and ignores stale loads", async () => {
    let resolveFirst!: (record: HeavyRecord) => void;
    hooks.getHeavy.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    hooks.getHeavy.mockResolvedValueOnce({
      _id: 8,
      _fullMessage: "Loaded full message",
      stackTrace: "Loaded stack trace",
    });
    const options = props();
    Object.assign(options.selectedEntry!, {
      _offloaded: true,
      _truncated: true,
    });
    let tree = render(options);
    expect(
      find(tree, "aria-label", "inspector.copyMessage").props.disabled,
    ).toBe(true);
    const next = props({
      selectedEntry: { ...options.selectedEntry, _id: 8 },
    });
    render(next);
    await Promise.resolve();
    resolveFirst({ _id: 7, _fullMessage: "Stale message" });
    await Promise.resolve();
    tree = render(next);
    click(find(tree, "aria-pressed", false));
    render(next);
    expect(useHighlightedHtml).toHaveBeenLastCalledWith(
      "Loaded full message",
      "timeout",
    );
  });

  it("reports missing heavy fields instead of loading forever", async () => {
    hooks.getHeavy.mockResolvedValueOnce(undefined);
    const options = props();
    Object.assign(options.selectedEntry!, {
      _offloaded: true,
      _truncated: true,
    });
    render(options);
    await Promise.resolve();
    expect(text(render(options))).toContain("inspector.unavailable");
  });

  it("logs the original load failure and reports even nontruncated entries", async () => {
    const error = new Error("IndexedDB read failed");
    hooks.getHeavy.mockRejectedValueOnce(error);
    const options = props({ onError: vi.fn() });
    options.selectedEntry!._offloaded = true;
    render(options);
    await Promise.resolve();
    expect(hooks.logError).toHaveBeenCalledWith(
      "Failed to load inspector heavy fields:",
      error,
    );
    expect(options.onError).toHaveBeenCalledWith("inspector.unavailable");
    expect(text(find(render(options), "role", "alert"))).toBe(
      "inspector.unavailable",
    );
  });

  it("logs stale load failures without alerting for a different selection", async () => {
    let reject!: (error: Error) => void;
    hooks.getHeavy.mockReturnValueOnce(
      new Promise((_resolve, rejectLoad) => (reject = rejectLoad)),
    );
    const options = props({ onError: vi.fn() });
    options.selectedEntry!._offloaded = true;
    render(options);
    const next = props();
    render(next);
    const error = new Error("Old load failed");
    reject(error);
    await Promise.resolve();
    expect(hooks.logError).toHaveBeenCalledWith(
      "Failed to load inspector heavy fields:",
      error,
    );
    expect(options.onError).not.toHaveBeenCalled();
    expect(text(render(next))).not.toContain("inspector.unavailable");
  });

  it("bounds fallback entry reads while preserving resolved heavy fields", async () => {
    const options = props();
    const entry = options.selectedEntry!;
    delete entry.raw;
    entry._offloaded = true;
    const read = vi.fn(() => "additional data");
    for (let i = 0; i < 3000; i++) {
      Object.defineProperty(entry, `field${i}`, {
        enumerable: true,
        get: read,
      });
    }
    hooks.getHeavy.mockResolvedValueOnce({
      _id: 7,
      _fullMessage: "Loaded full message",
      stackTrace: "Loaded trace",
    });
    let tree = render(options);
    await Promise.resolve();
    click(find(tree, "id", "inspector-test-tab-advanced"));
    tree = render(options);
    toggleRaw(tree, true);
    tree = render(options);
    expect(text(tree)).toContain("Loaded full message");
    expect(text(tree)).toContain("Loaded trace");
    expect(read.mock.calls.length).toBeLessThan(2000);
    expect(text(tree)).toContain("inspector.rawTruncated");
  });

  it("copies the full message and visibly reports clipboard failure", async () => {
    const options = props({ onError: vi.fn() });
    options.selectedEntry!._fullMessage = "Complete message";
    let tree = render(options);
    click(find(tree, "aria-label", "inspector.copyMessage"));
    await Promise.resolve();
    expect(hooks.writeText).toHaveBeenCalledWith("Complete message");
    expect(text(render(options))).toContain("inspector.copied");
    hooks.writeText.mockRejectedValueOnce(new Error("denied"));
    tree = render(options);
    click(find(tree, "aria-label", "inspector.copyMessage"));
    await Promise.resolve();
    expect(text(find(render(options), "role", "alert"))).toContain(
      "inspector.copyFailed",
    );
    expect(options.onError).toHaveBeenCalledWith("inspector.copyFailed");
  });

  it("keeps memoized scrolling behavior but notices optional action changes", () => {
    const options = props();
    expect(
      hooks.comparator!(options, { ...options, onAddMdcToFilter: vi.fn() }),
    ).toBe(true);
    expect(hooks.comparator!(options, { ...options, onClose: vi.fn() })).toBe(
      false,
    );
    expect(hooks.comparator!(options, { ...options, onError: vi.fn() })).toBe(
      false,
    );
    expect(
      hooks.comparator!(options, { ...options, onFilterByLogger: vi.fn() }),
    ).toBe(false);
  });
});

describe("bounded raw preview", () => {
  it("formats actual JSON primitives and objects", () => {
    const data = {
      message: "real\nmessage",
      context: { id: 42 },
      flags: [true, null],
    };
    const preview = createRawPreview(data);
    expect(JSON.parse(preview.text)).toEqual(data);
    expect(preview.truncated).toBe(false);
  });

  it("bounds huge strings, wide arrays and deeply nested payloads", () => {
    const string = createRawPreview({ payload: "x".repeat(100_000) });
    expect(string.text.length).toBeLessThanOrEqual(64 * 1024);
    expect(string.truncated).toBe(true);
    expect(
      createRawPreview(Array.from({ length: 10_000 }, (_, i) => i)).truncated,
    ).toBe(true);
    let nested: unknown = "bottom";
    for (let i = 0; i < 20; i++) nested = { nested };
    expect(createRawPreview(nested).truncated).toBe(true);
  });

  it("handles cycles and bigint without throwing or executing toJSON methods", () => {
    const data: Record<string, unknown> = { count: 5n, toJSON: vi.fn() };
    data.self = data;
    const result = createRawPreview(data);
    expect(result.text).toContain("[Circular]");
    expect(result.text).toContain('"5"');
    expect(data.toJSON).not.toHaveBeenCalled();
  });
});
