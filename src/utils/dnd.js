// Drag & Drop Manager: kapselt Events, extrahiert Pfade und meldet Aktiv-Status
export class DragAndDropManager {
  /**
   * @param {{ onFiles: (paths: string[]) => void|Promise<void>, onActiveChange?: (active: boolean) => void, onRawFiles?: (files: {name: string, data: string, encoding: 'utf8'|'base64'}[]) => void|Promise<void> }} opts
   */
  constructor(opts) {
    this.onFiles = opts.onFiles;
    this.onActiveChange = opts.onActiveChange || (() => {});
    this.onRawFiles = opts.onRawFiles || null;
    this._dragCounter = 0;
    this._handlers = null;
  }

  attach(target = window) {
    if (this._handlers) return;
    const debug = typeof window !== 'undefined' && !!window.__DEBUG_DND__;
    const onDragOverBlockAll = (e) => {
      e.preventDefault();
    };

    const isFileDrag = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      if (debug) {
        try {
          const types = Array.from(dt.types || []);
          console.log('[DnD] drag types:', types);
        } catch {}
      }
      // DataTransfer.types ist array-ähnlich, iterierbar
      let hasFiles = false;
      const types = dt.types;
      if (types && typeof types.length === 'number') {
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          if (
            t === 'Files' ||
            t === 'public.file-url' ||
            t === 'text/uri-list' ||
            t === 'text/plain'
          ) {
            hasFiles = true;
            break;
          }
        }
      }
      if (hasFiles) return true;
      const items = dt.items;
      if (items && typeof items.length === 'number') {
        for (let i = 0; i < items.length; i++) {
          if (items[i] && (items[i].kind === 'file' || items[i].type === 'text/uri-list'))
            return true;
        }
      }
      return false;
    };

    const fileUrlsToPaths = (data) => {
      if (!data) return [];
      const out = [];
      let start = 0;
      // einfache Zeilen-Split ohne Regex/Allokationen in Hot-Path
      for (let i = 0; i <= data.length; i++) {
        if (i === data.length || data.charCodeAt(i) === 10 /* \n */) {
          let line = data.slice(start, i);
          // trim CR und Spaces
          if (line.endsWith('\r')) line = line.slice(0, -1);
          line = line.trim();
          if (line) {
            if (line.startsWith('file://')) {
              try {
                const url = new URL(line);
                out.push(decodeURIComponent(url.pathname));
              } catch {}
            } else if (line.startsWith('/')) {
              // macOS Finder liefert teils plain absolute Pfade in text/plain
              out.push(line);
            }
          }
          start = i + 1;
        }
      }
      return out;
    };

    const extractPaths = (e) => {
      const dt = e.dataTransfer;
      const out = [];
      if (!dt) return out;
      // Prefer URI list/public.file-url for sandboxed renderers on macOS
      try {
        const uris = dt.getData('text/uri-list');
        const fromUris = fileUrlsToPaths(uris);
        if (fromUris.length) out.push(...fromUris);
      } catch {}
      try {
        const pub = dt.getData('public.file-url');
        const fromPub = fileUrlsToPaths(pub);
        if (fromPub.length) out.push(...fromPub);
      } catch {}
      // Manche Umgebungen liefern file:// oder Plain-Pfade in text/plain
      try {
        const plain = dt.getData('text/plain');
        const fromPlain = fileUrlsToPaths(plain);
        if (fromPlain.length) out.push(...fromPlain);
      } catch {}
      // Fallback 1: FileList .path (benötigt sandbox=false)
      try {
        const files = dt.files;
        if (files && typeof files.length === 'number') {
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const p = /** @type {any} */ (f).path || '';
            if (p) out.push(p);
          }
        }
      } catch {}
      // Fallback 2: DataTransferItem.getAsFile().path
      try {
        const items = dt.items;
        if (items && typeof items.length === 'number') {
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it && it.kind === 'file') {
              const f = it.getAsFile?.();
              const p = f && /** @type {any} */ (f).path;
              if (p) out.push(p);
            }
          }
        }
      } catch {}
      if (debug) console.log('[DnD] extracted paths before dedupe:', out.slice());
      // Deduplizieren ohne Set
      if (out.length > 1) {
        const seen = Object.create(null);
        const dedup = [];
        for (let i = 0; i < out.length; i++) {
          const p = out[i];
          if (!seen[p]) {
            seen[p] = 1;
            dedup.push(p);
          }
        }
        if (debug) console.log('[DnD] deduped paths:', dedup.slice());
        return dedup;
      }
      return out;
    };

    const readFilesAsPayloads = async (fileList) => {
      const out = [];
      if (!fileList || typeof fileList.length !== 'number') return out;
      /** @type {(f: File) => Promise<{name: string, data: string, encoding: 'utf8'|'base64'}>} */
      const readOne = (f) =>
        new Promise((resolve) => {
          try {
            const name = String(f?.name || '');
            const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
            const fr = new FileReader();
            if (ext === '.zip') {
              fr.onload = () => {
                try {
                  const buf = new Uint8Array(fr.result);
                  // zu base64
                  let bin = '';
                  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                  const b64 = btoa(bin);
                  resolve({ name, data: b64, encoding: 'base64' });
                } catch {
                  resolve({ name, data: '', encoding: 'base64' });
                }
              };
              fr.onerror = () => resolve({ name, data: '', encoding: 'base64' });
              fr.readAsArrayBuffer(f);
            } else {
              fr.onload = () => resolve({ name, data: String(fr.result || ''), encoding: 'utf8' });
              fr.onerror = () => resolve({ name, data: '', encoding: 'utf8' });
              fr.readAsText(f, 'utf-8');
            }
          } catch {
            resolve({ name: String(f?.name || ''), data: '', encoding: 'utf8' });
          }
        });
      for (let i = 0; i < fileList.length; i++) out.push(await readOne(fileList[i]));
      return out;
    };

    const extractPathsFromItemsAsync = async (e) => {
      const dt = e.dataTransfer;
      if (!dt || !dt.items || !dt.items.length) return [];
      const wanted = new Set(['text/uri-list', 'public.file-url', 'text/plain']);
      const promises = [];
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (!it) continue;
        const t = it.type || '';
        if (!wanted.has(t)) continue;
        if (typeof it.getAsString === 'function') {
          promises.push(
            new Promise((resolve) => {
              try {
                it.getAsString((str) => {
                  try {
                    resolve(fileUrlsToPaths(String(str || '')));
                  } catch {
                    resolve([]);
                  }
                });
              } catch {
                resolve([]);
              }
            })
          );
        }
      }
      const chunks = await Promise.all(promises);
      const out = [].concat(...chunks);
      if (out.length > 1) {
        const seen = Object.create(null);
        const dedup = [];
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

    const onDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragCounter++;
      if (this._dragCounter === 1) this.onActiveChange(true);
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragCounter = Math.max(0, this._dragCounter - 1);
      if (this._dragCounter === 0) this.onActiveChange(false);
    };
    const onDrop = async (e) => {
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
        } catch {}
      }
      if (debug) console.log('[DnD] final paths:', (paths || []).slice());
      if (paths && paths.length) {
        try {
          await this.onFiles(paths);
        } catch (err) {
          console.error('DnD onFiles error:', err);
        }
        return;
      }
      // Letzter Fallback: Dateien direkt lesen und als Rohdaten liefern (benötigt opts.onRawFiles)
      try {
        if (this.onRawFiles && e?.dataTransfer?.files?.length) {
          const payloads = await readFilesAsPayloads(e.dataTransfer.files);
          if (debug)
            console.log(
              '[DnD] raw file payloads:',
              payloads.map((p) => ({ name: p.name, enc: p.encoding, size: p.data?.length || 0 }))
            );
          if (payloads && payloads.length) await this.onRawFiles(payloads);
        }
      } catch (err) {
        console.error('DnD onRawFiles error:', err);
      }
    };

    // Two layers: block default navigation and add functional handlers (with capture)
    target.addEventListener('dragover', onDragOverBlockAll, { capture: true });
    target.addEventListener('drop', onDragOverBlockAll, { capture: true });

    target.addEventListener('dragenter', onDragEnter, { capture: true });
    target.addEventListener('dragover', onDragOver, { capture: true });
    target.addEventListener('dragleave', onDragLeave, { capture: true });
    target.addEventListener('drop', onDrop, { capture: true });

    this._handlers = { onDragOverBlockAll, onDragEnter, onDragOver, onDragLeave, onDrop, target };
  }

  detach() {
    const h = this._handlers;
    if (!h) return;
    const t = h.target;
    t.removeEventListener('dragover', h.onDragOverBlockAll, { capture: true });
    t.removeEventListener('drop', h.onDragOverBlockAll, { capture: true });

    t.removeEventListener('dragenter', h.onDragEnter, { capture: true });
    t.removeEventListener('dragover', h.onDragOver, { capture: true });
    t.removeEventListener('dragleave', h.onDragLeave, { capture: true });
    t.removeEventListener('drop', h.onDrop, { capture: true });

    this._handlers = null;
  }
}
