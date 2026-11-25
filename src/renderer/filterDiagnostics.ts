import { createChangeEmitter } from "../store/changeEmitter";

export const FILTER_SAMPLE_LIMIT = 100;
const VISIBILITY_PROBE_MS = 1000;

interface FilterSample {
  trigger: "new-view" | "refresh";
  inputCount: number;
  resultCount: number;
  firstVisibleMs: number | null;
  finalListMs: number;
  longestTaskMs: number | null;
}

interface Run {
  id: number;
  start: number;
  end: number | null;
  sample: FilterSample;
}

function resultInViewport(list: HTMLElement, empty: boolean): boolean {
  const bounds = list.getBoundingClientRect();
  const top = Math.max(
    0,
    bounds.top,
    list.querySelector(".list-header")?.getBoundingClientRect().bottom ?? 0,
  );
  const bottom = Math.min(innerHeight, bounds.bottom);
  const left = Math.max(0, bounds.left);
  const right = Math.min(innerWidth, bounds.right);
  for (const el of list.querySelectorAll(
    empty ? ".list-empty-title" : '.row[role="option"] .col.msg',
  )) {
    const box = el.getBoundingClientRect();
    const x1 = Math.max(left, box.left);
    const x2 = Math.min(right, box.right);
    const y1 = Math.max(top, box.top);
    const y2 = Math.min(bottom, box.bottom);
    if (
      x1 < x2 &&
      y1 < y2 &&
      el.contains(document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2))
    ) {
      return true;
    }
  }
  return false;
}

/** Window-local. Only completed submissions are added to the export. */
export class FilterDiagnostics {
  private active: Run | undefined;
  private readonly history: Run[] = [];
  private publication?: { stats: { passed: number }; final: boolean };
  private frame?: number;
  private observer?: PerformanceObserver;
  // Wait for Electron's initial visibility reply; document.hidden can be
  // false even for a background window with background throttling disabled.
  private nativeVisible = false;
  private readonly changes = createChangeEmitter();
  subscribe(listener: () => void) {
    return this.changes.on(listener);
  }

  connect(): () => void {
    const visibilityChanged = () => {
      if (!this.nativeVisible || document.hidden) this.cancel();
    };
    const off = window.api.onWindowVisibilityChange((visible) => {
      this.nativeVisible = visible;
      visibilityChanged();
    });
    document.addEventListener("visibilitychange", visibilityChanged);
    if (
      globalThis.PerformanceObserver?.supportedEntryTypes.includes("longtask")
    ) {
      this.observer = new PerformanceObserver((list) =>
        this.applyTasks(list.getEntries()),
      );
      this.observer.observe({ type: "longtask" });
    }
    return () => {
      this.cancel();
      this.observer?.disconnect();
      this.observer = undefined;
      this.history.length = 0;
      off();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }

  start(id: number, start: number, inputCount: number, newView: boolean) {
    this.cancel();
    if (!this.nativeVisible || document.hidden) return;
    this.active = {
      id,
      start,
      end: null,
      sample: {
        trigger: newView ? "new-view" : "refresh",
        inputCount,
        resultCount: 0,
        firstVisibleMs: null,
        finalListMs: 0,
        longestTaskMs: this.observer ? 0 : null,
      },
    };
  }

  cancel() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.publication = undefined;
    this.active = undefined;
  }

  published(id: number, stats: { passed: number }, final: boolean) {
    if (this.active?.id === id && this.active.end === null)
      this.publication = { stats, final };
  }

  committed(stats: { passed: number } | null, list: HTMLElement | null) {
    const run = this.active;
    const published = this.publication;
    // The very same stats snapshot must have reached the rendered view, not
    // merely arrived from the worker (which can also publish older appends).
    if (!run || !published || published.stats !== stats || !list) return;
    this.publication = undefined;
    const now = performance.now();
    run.sample.resultCount = stats.passed;
    if (published.final) {
      run.end = now;
      run.sample.finalListMs = now - run.start;
      this.history.push(run);
      if (this.history.length > FILTER_SAMPLE_LIMIT) this.history.shift();
      this.changes.emit();
    }
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (
      run.sample.firstVisibleMs !== null ||
      (!published.final && !stats.passed)
    )
      return;
    // Hydration belongs to the virtual list: its rows can appear after the
    // parent's commit. Never poll indefinitely for an off-screen empty state.
    const probe = () => {
      this.frame = undefined;
      if (this.active !== run || document.hidden) return;
      const time = performance.now();
      if (time - now > VISIBILITY_PROBE_MS) return;
      if (resultInViewport(list, !stats.passed)) {
        run.sample.firstVisibleMs = time - run.start;
        if (run.end !== null) this.changes.emit();
      } else {
        this.frame = requestAnimationFrame(probe);
      }
    };
    this.frame = requestAnimationFrame(probe);
  }

  private applyTasks(entries: PerformanceEntry[]) {
    // Long Tasks can be delivered after the final DOM commit. Keep only the
    // longest overlap, never the entries (which may carry attribution).
    let changed = false;
    const apply = (run: Run) => {
      for (const task of entries) {
        const overlap =
          Math.min(run.end ?? Infinity, task.startTime + task.duration) -
          Math.max(run.start, task.startTime);
        if (overlap > (run.sample.longestTaskMs ?? 0)) {
          run.sample.longestTaskMs = overlap;
          changed ||= run.end !== null;
        }
      }
    };
    if (this.active?.end === null) apply(this.active);
    this.history.forEach(apply);
    if (changed) this.changes.emit();
  }

  report() {
    return {
      schemaVersion: 1,
      unit: "ms",
      samples: this.history.map(({ sample }) => ({ ...sample })),
    };
  }
}
