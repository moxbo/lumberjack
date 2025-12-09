// Highlight service for managing worker-based formatting
// Provides an async API for formatting log messages and stack traces

interface HighlightRequest {
  id: string;
  message: string;
  level?: string | null;
  stackTrace?: string | null;
}

interface HighlightResponse {
  id: string;
  formattedMessage: string;
  formattedStackTrace?: string;
  error?: string;
}

interface PendingRequest {
  resolve: (result: {
    formattedMessage: string;
    formattedStackTrace?: string;
  }) => void;
  reject: (error: Error) => void;
}

class HighlightService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private enabled = true;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      // Worker will be initialized when first used
      // This avoids issues with worker initialization during module load
    } catch (error) {
      console.error("Failed to initialize highlight worker:", error);
      this.enabled = false;
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;

    try {
      // Create worker using inline worker pattern for Vite/esbuild compatibility
      const workerUrl = new URL(
        "../workers/highlight.worker.ts",
        import.meta.url,
      );
      this.worker = new Worker(workerUrl, { type: "module" });

      this.worker.onmessage = (e: MessageEvent<HighlightResponse>) => {
        const { id, formattedMessage, formattedStackTrace, error } = e.data;
        const pending = this.pendingRequests.get(id);

        if (pending) {
          this.pendingRequests.delete(id);

          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve({ formattedMessage, formattedStackTrace });
          }
        }
      };

      this.worker.onerror = (error) => {
        console.error("Highlight worker error:", error);
        // Reject all pending requests
        this.pendingRequests.forEach((pending) => {
          pending.reject(new Error("Worker error"));
        });
        this.pendingRequests.clear();
      };
    } catch (error) {
      console.error("Failed to create highlight worker:", error);
      this.enabled = false;
    }
  }

  async formatLog(
    message: string,
    level?: string | null,
    stackTrace?: string | null,
  ): Promise<{ formattedMessage: string; formattedStackTrace?: string }> {
    // Fallback to synchronous formatting if worker is not available
    if (!this.enabled) {
      return this.formatLogSync(message, level, stackTrace);
    }

    this.ensureWorker();

    if (!this.worker) {
      return this.formatLogSync(message, level, stackTrace);
    }

    return new Promise((resolve, reject) => {
      const id = `req_${++this.requestCounter}`;

      this.pendingRequests.set(id, { resolve, reject });

      const request: HighlightRequest = {
        id,
        message,
        level,
        stackTrace,
      };

      this.worker!.postMessage(request);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Highlight timeout"));
        }
      }, 5000);
    });
  }

  // Synchronous fallback formatting (simplified)
  private formatLogSync(
    message: string,
    _level?: string | null,
    stackTrace?: string | null,
  ): { formattedMessage: string; formattedStackTrace?: string } {
    // Simple escaping for safety
    const escape = (str: string): string =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    return {
      formattedMessage: escape(message),
      formattedStackTrace: stackTrace ? escape(stackTrace) : undefined,
    };
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

// Singleton instance
export const highlightService = new HighlightService();
