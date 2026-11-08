export const HIDDEN_PUBLICATION_DELAY_MS = 1000;

/** Only schedules UI publication; persistence and producer acknowledgements never wait on it. */
export class VisibilityScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private nativeVisible: boolean | undefined;
  private readonly offNativeVisibility: (() => void) | undefined;
  private readonly document =
    typeof document === "undefined" ? undefined : document;

  constructor(
    private readonly publish: () => void,
    private readonly visibleDelay: () => number = () => 0,
  ) {
    this.document?.addEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    // Electron keeps document.hidden false with backgroundThrottling disabled.
    this.offNativeVisibility =
      typeof window === "undefined"
        ? undefined
        : window.api?.onWindowVisibilityChange?.((visible) => {
            if (this.nativeVisible === visible) return;
            this.nativeVisible = visible;
            this.onVisibilityChange();
          });
  }

  get hidden(): boolean {
    return this.nativeVisible === false || this.document?.hidden === true;
  }

  schedule(immediate = false): void {
    this.pending = true;
    if (!this.hidden && immediate) {
      this.flush();
    } else if (this.timer === undefined) {
      this.timer = setTimeout(
        () => this.flush(),
        this.hidden ? HIDDEN_PUBLICATION_DELAY_MS : this.visibleDelay(),
      );
    }
  }

  flush(): void {
    this.cancel();
    this.publish();
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  dispose(): void {
    this.cancel();
    this.offNativeVisibility?.();
    this.document?.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.pending) return;
    if (!this.hidden) this.flush();
    else {
      this.cancel();
      this.schedule();
    }
  };
}
