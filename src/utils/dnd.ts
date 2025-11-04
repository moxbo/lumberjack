// Drag & Drop Manager: kapselt Events, extrahiert Pfade und meldet Aktiv-Status
import logger from "./logger";

export type RawFilePayload = {
  name: string;
  data: string;
  encoding: "utf8" | "base64";
};
export type DnDOptions = {
  onFiles: (paths: string[]) => void | Promise<void>;
  onActiveChange?: (active: boolean) => void;
  onRawFiles?: (files: RawFilePayload[]) => void | Promise<void>;
};

export class DragAndDropManager {
  private onFiles: (paths: string[]) => void | Promise<void>;
  private onActiveChange: (active: boolean) => void;
  private onRawFiles:
    | ((files: RawFilePayload[]) => void | Promise<void>)
    | null;
  private _dragCounter: number;
  private _handlers: {
    onDragOverBlockAll: (e: DragEvent) => void;
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => Promise<void>;
    target: Window | HTMLElement;
  } | null;

  /**
   * @param opts Drag & Drop Callbacks
   */
  constructor(opts: DnDOptions) {
    this.onFiles = opts.onFiles;
    this.onActiveChange = opts.onActiveChange || (() => {});
    this.onRawFiles = opts.onRawFiles || null;
    this._dragCounter = 0;
    this._handlers = null;
  }

  attach(target: Window | HTMLElement = window) {
    if (this._handlers) return;
    const debug =
      typeof window !== "undefined" && !!(window as any).__DEBUG_DND__;

    const onDragOverBlockAll = (e: DragEvent) => {
      e.preventDefault();
    };

    const isFileDrag = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      if (debug) {
        try {
          const types = Array.from(dt.types || ([] as any));
          logger.log("[DnD] drag types:", types);
        } catch (e) {
          logger.warn("DnD: failed to log drag types:", e);
        }
      }
      // DataTransfer.types ist array-ähnlich, iterierbar
      let hasFiles = false;
      const types: any = dt.types as any;
      if (types && typeof types.length === "number") {
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          if (
            t === "Files" ||
            t === "public.file-url" ||
            t === "text/uri-list" ||
            t === "text/plain"
          ) {
            hasFiles = true;
            break;
          }
        }
      }
      if (hasFiles) return true;
      const items = dt.items as DataTransferItemList | null;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it && (it.kind === "file" || it.type === "text/uri-list"))
            return true;
        }
      }
      return false;
    };

    const fileUrlsToPaths = (data: string) => {
      if (!data) return [] as string[];
      const out: string[] = [];
      let start = 0;
      // einfache Zeilen-Split ohne Regex/Allokationen in Hot-Path
      for (let i = 0; i <= data.length; i++) {
        if (i === data.length || data.charCodeAt(i) === 10 /* \n */) {
          let line = data.slice(start, i);
          // trim CR und Spaces
          if (line.endsWith("\r")) line = line.slice(0, -1);
          line = line.trim();
          if (line) {
            if (line.startsWith("file://")) {
              try {
                const url = new URL(line);
                out.push(decodeURIComponent(url.pathname));
              } catch (e) {
                logger.warn("DnD: failed to decode file URL:", e);
              }
            } else if (line.startsWith("/")) {
              // macOS Finder liefert teils plain absolute Pfade in text/plain
              out.push(line);
            }
          }
          start = i + 1;
        }
      }
      return out;
    };

    const extractPaths = (e: DragEvent) => {
      const dt = e.dataTransfer;
      const out: string[] = [];
      if (!dt) return out;
      // Prefer URI list/public.file-url for sandboxed renderers on macOS
      try {
        const uris = dt.getData("text/uri-list");
        const fromUris = fileUrlsToPaths(uris);
        if (fromUris.length) out.push(...fromUris);
      } catch (e) {
        logger.warn("DnD: reading text/uri-list failed:", e);
      }
      try {
        const pub = dt.getData("public.file-url");
        const fromPub = fileUrlsToPaths(pub);
        if (fromPub.length) out.push(...fromPub);
      } catch (e) {
        logger.warn("DnD: reading public.file-url failed:", e);
      }
      // Manche Umgebungen liefern file:// oder Plain-Pfade in text/plain
      try {
        const plain = dt.getData("text/plain");
        const fromPlain = fileUrlsToPaths(plain);
        if (fromPlain.length) out.push(...fromPlain);
      } catch (e) {
        logger.warn("DnD: reading text/plain failed:", e);
      }
      // Fallback 1: FileList .path (benötigt sandbox=false)
      try {
        const files = dt.files as FileList | undefined;
        if (files) {
          for (let i = 0; i < files.length; i++) {
            const f = files[i] as any;
            const p = (f && f.path) || "";
            if (p) out.push(p);
          }
        }
      } catch (e) {
        logger.warn("DnD: reading FileList paths failed:", e);
      }
      // Fallback 2: DataTransferItem.getAsFile().path
      try {
        const items = dt.items as DataTransferItemList | null;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it && it.kind === "file") {
              const f = it.getAsFile?.();
              const p = f && (f as any).path;
              if (p) out.push(p);
            }
          }
        }
      } catch (e) {
        logger.warn("DnD: reading DataTransferItem paths failed:", e);
      }
      if (debug)
        logger.log("[DnD] extracted paths before dedupe:", out.slice());
      // Deduplizieren ohne Set
      if (out.length > 1) {
        const seen: Record<string, 1> = Object.create(null);
        const dedup: string[] = [];
        for (let i = 0; i < out.length; i++) {
          const p = out[i];
          if (!seen[p]) {
            seen[p] = 1;
            dedup.push(p);
          }
        }
        if (debug) logger.log("[DnD] deduped paths:", dedup.slice());
        return dedup;
      }
      return out;
    };

    const readFilesAsPayloads = async (
      fileList: FileList,
    ): Promise<RawFilePayload[]> => {
      const out: RawFilePayload[] = [];
      if (!fileList) return out;
      const readOne = (f: File) =>
        new Promise<RawFilePayload>((resolve) => {
          try {
            const name = String((f as any)?.name || "");
            const ext = name.toLowerCase().slice(name.lastIndexOf("."));
            const fr = new FileReader();
            if (ext === ".zip") {
              fr.onload = () => {
                try {
                  const res = fr.result;
                  const buf =
                    res instanceof ArrayBuffer
                      ? new Uint8Array(res)
                      : new Uint8Array();
                  // zu base64
                  let bin = "";
                  for (let i = 0; i < buf.length; i++)
                    bin += String.fromCharCode(buf[i]);
                  const b64 = btoa(bin);
                  resolve({ name, data: b64, encoding: "base64" });
                } catch {
                  resolve({ name, data: "", encoding: "base64" });
                }
              };
              fr.onerror = () =>
                resolve({ name, data: "", encoding: "base64" });
              fr.readAsArrayBuffer(f);
            } else {
              fr.onload = () => {
                const result = fr.result;
                const data = typeof result === "string" ? result : "";
                resolve({ name, data, encoding: "utf8" });
              };
              fr.onerror = () => resolve({ name, data: "", encoding: "utf8" });
              fr.readAsText(f, "utf-8");
            }
          } catch {
            const fileName =
              f &&
              typeof f === "object" &&
              "name" in f &&
              typeof f.name === "string"
                ? f.name
                : "";
            resolve({ name: fileName, data: "", encoding: "utf8" });
          }
        });
      for (let i = 0; i < fileList.length; i++)
        out.push(await readOne(fileList[i]!));
      return out;
    };

    const extractPathsFromItemsAsync = async (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt || !dt.items || !dt.items.length) return [] as string[];
      const wanted = new Set([
        "text/uri-list",
        "public.file-url",
        "text/plain",
      ]);
      const promises: Promise<string[]>[] = [];
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (!it) continue;
        const t = it.type || "";
        if (!wanted.has(t)) continue;
        if (typeof it.getAsString === "function") {
          promises.push(
            new Promise<string[]>((resolve) => {
              try {
                it.getAsString((str) => {
                  try {
                    resolve(fileUrlsToPaths(String(str || "")));
                  } catch (e) {
                    logger.warn("DnD: parsing getAsString data failed:", e);
                    resolve([]);
                  }
                });
              } catch (e) {
                logger.warn("DnD: getAsString failed:", e);
                resolve([]);
              }
            }),
          );
        }
      }
      const chunks = await Promise.all(promises);
      const out = ([] as string[]).concat(...chunks);
      if (out.length > 1) {
        const seen: Record<string, 1> = Object.create(null);
        const dedup: string[] = [];
        for (let i = 0; i < out.length; i++) {
          const p = out[i];
          if (!seen[p]) {
            seen[p] = 1;
            dedup.push(p);
          }
        }
        return dedup;
      }
      return out;
    };

    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragCounter++;
      if (this._dragCounter === 1) this.onActiveChange(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragCounter = Math.max(0, this._dragCounter - 1);
      if (this._dragCounter === 0) this.onActiveChange(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragCounter = 0;
      this.onActiveChange(false);
      let paths = extractPaths(e);
      if ((!paths || !paths.length) && e?.dataTransfer?.items?.length) {
        try {
          const fromItems = await extractPathsFromItemsAsync(e);
          if (fromItems && fromItems.length) paths = fromItems;
        } catch (err) {
          logger.warn("DnD: extractPathsFromItemsAsync failed:", err);
        }
      }
      if (debug) logger.log("[DnD] final paths:", (paths || []).slice());
      if (paths && paths.length) {
        try {
          await this.onFiles(paths);
        } catch (err) {
          logger.error("DnD onFiles error:", err);
        }
        return;
      }
      // Letzter Fallback: Dateien direkt lesen und als Rohdaten liefern (benötigt opts.onRawFiles)
      try {
        if (this.onRawFiles && e?.dataTransfer?.files?.length) {
          const payloads = await readFilesAsPayloads(e.dataTransfer.files);
          if (debug)
            logger.log(
              "[DnD] raw file payloads:",
              payloads.map((p) => ({
                name: p.name,
                enc: p.encoding,
                size: p.data?.length || 0,
              })),
            );
          if (payloads && payloads.length) await this.onRawFiles(payloads);
        }
      } catch (err) {
        logger.error("DnD onRawFiles error:", err);
      }
    };

    // Two layers: block default navigation and add functional handlers (with capture)
    (target as any).addEventListener(
      "dragover",
      onDragOverBlockAll as any,
      { capture: true } as any,
    );
    (target as any).addEventListener(
      "drop",
      onDragOverBlockAll as any,
      { capture: true } as any,
    );

    (target as any).addEventListener(
      "dragenter",
      onDragEnter as any,
      { capture: true } as any,
    );
    (target as any).addEventListener(
      "dragover",
      onDragOver as any,
      { capture: true } as any,
    );
    (target as any).addEventListener(
      "dragleave",
      onDragLeave as any,
      { capture: true } as any,
    );
    (target as any).addEventListener(
      "drop",
      onDrop as any,
      { capture: true } as any,
    );

    this._handlers = {
      onDragOverBlockAll,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      target,
    };
  }

  detach() {
    const h = this._handlers;
    if (!h) return;
    const t: any = h.target;
    t.removeEventListener("dragover", h.onDragOverBlockAll, {
      capture: true,
    } as any);
    t.removeEventListener("drop", h.onDragOverBlockAll, {
      capture: true,
    } as any);

    t.removeEventListener("dragenter", h.onDragEnter, { capture: true } as any);
    t.removeEventListener("dragover", h.onDragOver, { capture: true } as any);
    t.removeEventListener("dragleave", h.onDragLeave, { capture: true } as any);
    t.removeEventListener("drop", h.onDrop, { capture: true } as any);

    this._handlers = null;
  }
}
