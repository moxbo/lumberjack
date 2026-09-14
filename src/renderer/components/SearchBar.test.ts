import { describe, expect, it, vi } from "vitest";
import { SearchBar, type SearchBarProps } from "./SearchBar";

vi.mock("preact/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("preact/hooks")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
}));

function props(overrides: Partial<SearchBarProps> = {}): SearchBarProps {
  return {
    search: "old",
    setSearch: vi.fn(),
    searchMode: "insensitive",
    setSearchMode: vi.fn(),
    showSearchOptions: false,
    setShowSearchOptions: vi.fn(),
    fltHistSearch: [],
    showSearchHist: false,
    setShowSearchHist: vi.fn(),
    searchHistHighlightIdx: -1,
    setSearchHistHighlightIdx: vi.fn(),
    searchPos: null,
    searchHistRef: { current: null },
    searchPopRef: { current: null },
    searchInputRef: { current: null },
    setShowLoggerHist: vi.fn(),
    setShowThreadHist: vi.fn(),
    setShowMessageHist: vi.fn(),
    addFilterHistory: vi.fn(),
    searchMatchIdx: [0],
    selectedOneIdx: null,
    filteredIdx: [42],
    gotoSearchMatch: vi.fn(),
    t: (key) => key,
    ...overrides,
  };
}

function findNode(node: any, id: string): any {
  if (node?.props?.id === id) return node;
  const children = node?.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child && typeof child === "object") {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
}

function enter(value: string) {
  return { key: "Enter", currentTarget: { value }, preventDefault: vi.fn() };
}

describe("SearchBar committed search", () => {
  it("keeps typing local but commits clearing immediately", () => {
    const options = props();
    const input = findNode(SearchBar(options), "searchText");
    const onInput = input.props.onInput ?? input.props.oninput;
    onInput({ currentTarget: { value: "draft" } });
    expect(options.setSearch).not.toHaveBeenCalled();
    onInput({ currentTarget: { value: "" } });
    expect(options.setSearch).toHaveBeenCalledWith("");
  });

  it("commits a new query without jumping to old matches", () => {
    const options = props();
    findNode(SearchBar(options), "searchText").props.onKeyDown(enter("new"));
    expect(options.setSearch).toHaveBeenCalledWith("new");
    expect(options.gotoSearchMatch).not.toHaveBeenCalled();
  });

  it("navigates available partial matches on repeated Enter", () => {
    const options = props();
    findNode(SearchBar(options), "searchText").props.onKeyDown(enter("old"));
    expect(options.gotoSearchMatch).toHaveBeenCalledWith(1);
  });

  it("commits history selection without navigating stale matches", () => {
    const options = props({
      showSearchHist: true,
      fltHistSearch: ["history"],
      searchHistHighlightIdx: 0,
    });
    findNode(SearchBar(options), "searchText").props.onKeyDown(enter("old"));
    expect(options.setSearch).toHaveBeenCalledWith("history");
    expect(options.gotoSearchMatch).not.toHaveBeenCalled();
  });

  it("looks up selection through stable ID positions without scanning IDs", () => {
    const ids = [42];
    const scan = vi.spyOn(ids, "indexOf").mockImplementation(() => {
      throw new Error("Full list scan");
    });
    const options = props({
      filteredIdx: ids,
      selectedOneIdx: 42,
      positionOfId: () => 0,
    });
    expect(() => SearchBar(options)).not.toThrow();
    expect(scan).not.toHaveBeenCalled();
  });
});
