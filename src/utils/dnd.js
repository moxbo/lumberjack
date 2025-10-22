// Drag & Drop Manager: kapselt Events, extrahiert Pfade und meldet Aktiv-Status
export class DragAndDropManager {
  /**
   * @param {{ onFiles: (paths: string[]) => void|Promise<void>, onActiveChange?: (active: boolean) => void }} opts
   */
  constructor(opts) {
    this.onFiles = opts.onFiles;
    this.onActiveChange = opts.onActiveChange || (() => {});
    this._dragCounter = 0;
    this._handlers = null;
  }

  attach(target = window) {
    if (this._handlers) return;
    const onDragOverBlockAll = (e) => {
      e.preventDefault();
    };

    const isFileDrag = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      // DataTransfer.types ist array-ähnlich, iterierbar
      let hasFiles = false;
      const types = dt.types;
      if (types && typeof types.length === 'number') {
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          if (t === 'Files' || t === 'public.file-url' || t === 'text/uri-list') {
            hasFiles = true;
            break;
          }
        }
      }
      if (hasFiles) return true;
      const items = dt.items;
      if (items && typeof items.length === 'number') {
        for (let i = 0; i < items.length; i++) {
          if (items[i] && items[i].kind === 'file') return true;
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
          if (line && line.startsWith('file://')) {
            try {
              const url = new URL(line);
              out.push(decodeURIComponent(url.pathname));
            } catch {}
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
      // Prefer URI list for sandboxed renderers on macOS
      try {
        const uris = dt.getData('text/uri-list');
        const fromUris = fileUrlsToPaths(uris);
        if (fromUris.length) {
          for (let i = 0; i < fromUris.length; i++) out.push(fromUris[i]);
        }
      } catch {}
      // Fallback to FileList .path if available (may be empty in sandbox)
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
        return dedup;
      }
      return out;
    };

    const allowed = new Set(['.log', '.json', '.zip']);

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
      // Filter by allowed extensions
      if (paths.length) {
        const filtered = [];
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          const dot = p.lastIndexOf('.');
          const ext = dot >= 0 ? p.slice(dot).toLowerCase() : '';
          if (allowed.has(ext)) filtered.push(p);
        }
        paths = filtered;
      }
      if (!paths.length) return;
      try {
        await this.onFiles(paths);
      } catch (err) {
        console.error('DnD onFiles error:', err);
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
