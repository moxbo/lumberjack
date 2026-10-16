import { afterEach, describe, expect, it, vi } from "vitest";
import { DragAndDropManager } from "../dnd";

vi.mock("../logger", () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.unstubAllGlobals());

function setup(nativePath: string) {
  class TestWindow extends EventTarget {
    api = { getPathForFile: vi.fn(() => nativePath) };
  }
  const target = new TestWindow();
  const read = vi.fn();
  class TestFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    readAsText(file: File) {
      read(file);
      void file.text().then((text) => {
        this.result = text;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("Window", TestWindow);
  vi.stubGlobal("window", target);
  vi.stubGlobal("FileReader", TestFileReader);
  const onFiles = vi.fn(async () => {});
  const onRawFiles = vi.fn(async () => {});
  new DragAndDropManager({ onFiles, onRawFiles }).attach();
  const file = new File(["message"], "drop.log");
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: ["Files"],
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
      getData: () => "",
    },
  });
  target.dispatchEvent(event);
  return { target, file, read, onFiles, onRawFiles };
}

describe("drag-and-drop file paths", () => {
  it("uses preload webUtils paths without the removed File.path property", async () => {
    const { target, file, read, onFiles, onRawFiles } = setup("/logs/drop.log");
    await vi.waitFor(() =>
      expect(onFiles).toHaveBeenCalledExactlyOnceWith(["/logs/drop.log"]),
    );
    expect(target.api.getPathForFile).toHaveBeenCalledWith(file);
    expect(read).not.toHaveBeenCalled();
    expect(onRawFiles).not.toHaveBeenCalled();
  });

  it("keeps the raw fallback for browser-created files without native paths", async () => {
    const { read, onFiles, onRawFiles } = setup("");
    await vi.waitFor(() =>
      expect(onRawFiles).toHaveBeenCalledExactlyOnceWith([
        { name: "drop.log", encoding: "utf8", data: "message" },
      ]),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
