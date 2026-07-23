/**
 * ErrorBoundary Component for Preact
 * Catches errors in the component tree and provides a fallback UI
 */

import { Component } from "preact";
import type { ComponentChildren } from "preact";
import { I18nContext } from "../utils/i18n";

interface ErrorBoundaryProps {
  children: ComponentChildren;
  fallback?: (error: Error, reset: () => void) => ComponentChildren;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

/**
 * Check if an error is a DataCloneError (out of memory)
 */
function isDataCloneError(error: Error): boolean {
  return (
    error.name === "DataCloneError" ||
    error.message.includes("DataCloneError") ||
    error.message.includes("out of memory") ||
    error.message.includes("Data cannot be cloned")
  );
}

/**
 * ErrorBoundary catches errors in child components and displays a fallback UI
 * This prevents UI errors from crashing the entire application
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  // Declare context type
  static contextType = I18nContext;
  declare context: { t: (key: string) => string };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  componentDidCatch(error: Error, errorInfo: Record<string, unknown>): void {
    // Log error to console
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);

    // Update state to show fallback UI
    this.setState((prevState) => ({
      hasError: true,
      error,
      errorCount: prevState.errorCount + 1,
    }));

    // Log to main process via IPC if available
    try {
      if (typeof window !== "undefined") {
        const win = window as unknown as Record<string, unknown>;
        const api = win.api as
          Record<string, (...args: unknown[]) => void> | undefined;
        if (api?.logError) {
          void (api.logError as (...args: unknown[]) => void)({
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
              isDataCloneError: isDataCloneError(error),
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

  /**
   * Full app reload as last resort
   */
  private reloadApp = (): void => {
    window.location.reload();
  };

  render(): ComponentChildren {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      const isMemoryError = isDataCloneError(this.state.error);
      const showReloadOption = this.state.errorCount > 2;

      // Get translation function from context (with fallback)
      const t = this.context?.t || ((key: string) => key);

      // Default fallback UI
      return (
        <div
          style={{
            padding: "20px",
            margin: "20px",
            border: `2px solid ${isMemoryError ? "#f59e0b" : "#ef4444"}`,
            borderRadius: "8px",
            backgroundColor: isMemoryError ? "#fef3c7" : "#fee",
          }}
        >
          <h2
            style={{
              color: isMemoryError ? "#d97706" : "#ef4444",
              marginTop: 0,
            }}
          >
            {isMemoryError
              ? `⚠️ ${t("errorBoundary.titleMemory")}`
              : `⚠️ ${t("errorBoundary.title")}`}
          </h2>
          <p>
            {isMemoryError
              ? t("errorBoundary.descriptionMemory")
              : t("errorBoundary.description")}
          </p>

          {isMemoryError && (
            <div
              style={{
                marginTop: "10px",
                padding: "10px",
                backgroundColor: "#fff",
                border: "1px solid #f59e0b",
                borderRadius: "4px",
              }}
            >
              <strong>{t("errorBoundary.recommendations")}</strong>
              <ul style={{ marginBottom: 0 }}>
                <li>{t("errorBoundary.recommendationSmaller")}</li>
                <li>{t("errorBoundary.recommendationFilter")}</li>
                <li>{t("errorBoundary.recommendationClose")}</li>
              </ul>
            </div>
          )}

          <details style={{ marginTop: "10px" }}>
            <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
              {t("errorBoundary.errorDetails")}
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

          <div style={{ marginTop: "15px", display: "flex", gap: "10px" }}>
            <button
              onClick={this.reset}
              style={{
                padding: "8px 16px",
                backgroundColor: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              {t("errorBoundary.retry")}
            </button>

            {showReloadOption && (
              <button
                onClick={this.reloadApp}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#6b7280",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                {t("errorBoundary.reloadApp")}
              </button>
            )}
          </div>
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
