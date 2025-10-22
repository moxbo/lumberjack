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
      const types = new Set(Array.from(dt.types || []));
      if (types.has('Files') || types.has('public.file-url') || types.has('text/uri-list'))
        return true;
      return !!(dt.items && Array.from(dt.items).some((it) => it.kind === 'file'));
    };

    const fileUrlsToPaths = (data) => {
      if (!data) return [];
      const lines = data
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const out = [];
      for (const line of lines) {
        if (line.startsWith('file://')) {
          try {
            const url = new URL(line);
            out.push(decodeURIComponent(url.pathname));
          } catch {}
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
        out.push(...fileUrlsToPaths(uris));
      } catch {}
      // Fallback to FileList .path if available (may be empty in sandbox)
      try {
        const files = Array.from(dt.files || []);
        for (const f of files) {
          const p = /** @type {any} */ (f).path || '';
          if (p) out.push(p);
        }
      } catch {}
      return Array.from(new Set(out));
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
      paths = paths.filter((p) => {
        const dot = p.lastIndexOf('.');
        const ext = dot >= 0 ? p.slice(dot).toLowerCase() : '';
        return allowed.has(ext);
      });
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
