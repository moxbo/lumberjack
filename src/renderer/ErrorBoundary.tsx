/**
 * ErrorBoundary Component for Preact
 * Catches errors in the component tree and provides a fallback UI
 */

import { Component } from "preact";
import type { ComponentChildren } from "preact";

interface ErrorBoundaryProps {
  children: ComponentChildren;
  fallback?: (error: Error, reset: () => void) => ComponentChildren;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches errors in child components and displays a fallback UI
 * This prevents UI errors from crashing the entire application
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  componentDidCatch(error: Error, errorInfo: Record<string, unknown>): void {
    // Log error to console
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);

    // Update state to show fallback UI
    this.setState({ hasError: true, error });

    // Log to main process via IPC if available
    try {
      if (typeof window !== "undefined") {
        const win = window as unknown as Record<string, unknown>;
        const electronAPI = win.electronAPI as
          | Record<string, (...args: unknown[]) => void>
          | undefined;
        if (electronAPI?.logError) {
          void (electronAPI.logError as (...args: unknown[]) => void)({
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
            errorInfo,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (logError) {
      console.error(
        "[ErrorBoundary] Failed to log error to main process:",
        logError,
      );
    }
  }

  /**
   * Reset the error boundary state
   */
  private reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      // Default fallback UI
      return (
        <div
          style={{
            padding: "20px",
            margin: "20px",
            border: "2px solid #ef4444",
            borderRadius: "8px",
            backgroundColor: "#fee",
          }}
        >
          <h2 style={{ color: "#ef4444", marginTop: 0 }}>
            ⚠️ Ein Fehler ist aufgetreten
          </h2>
          <p>
            Die Anwendung hat einen unerwarteten Fehler festgestellt. Sie können
            versuchen, die Aktion erneut auszuführen.
          </p>
          <details style={{ marginTop: "10px" }}>
            <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
              Fehlerdetails
            </summary>
            <pre
              style={{
                marginTop: "10px",
                padding: "10px",
                backgroundColor: "#fff",
                border: "1px solid #ccc",
                borderRadius: "4px",
                overflow: "auto",
                fontSize: "12px",
              }}
            >
              {this.state.error.name}: {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
          </details>
          <button
            onClick={this.reset}
            style={{
              marginTop: "15px",
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based error boundary helper
 * Use this to wrap async operations that might throw
 */
export function withErrorBoundary<T extends (...args: unknown[]) => unknown>(
  fn: T,
  onError?: (error: Error) => void,
): T {
  return ((...args: Parameters<T>) => {
    try {
      const result = fn(...args);

      // Handle promises
      if (
        result &&
        typeof (result as Record<string, unknown>).then === "function"
      ) {
        return (result as Promise<unknown>).catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error("[withErrorBoundary] Async error:", err);
          if (onError) onError(err);
          throw err;
        }) as unknown as T;
      }

      return result as T;
    } catch (error) {
      console.error("[withErrorBoundary] Sync error:", error);
      if (onError && error instanceof Error) onError(error);
      throw error;
    }
  }) as T;
}
