// Highlight worker for expensive formatting operations
// Runs in a separate thread to avoid blocking the UI

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

// Cache for formatted results
const formatCache = new Map<string, { formattedMessage: string; formattedStackTrace?: string }>();
const MAX_CACHE_SIZE = 10000;

// Simple hash function for cache keys (djb2)
function hashString(str: string): string {
  let hash = 5381;
  // Limit to first 1000 characters for performance on very long messages
  const maxLen = Math.min(str.length, 1000);
  for (let i = 0; i < maxLen; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) + hash + char; // hash * 33 + char
  }
  // Convert to positive 32-bit integer and then to base36
  return (hash >>> 0).toString(36);
}

// Format message with syntax highlighting
function formatMessage(message: string, level?: string | null): string {
  // Simple formatting - can be enhanced with more sophisticated highlighting
  let formatted = message;

  // Highlight URLs
  formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<span class="highlight-url">$1</span>');

  // Highlight numbers
  formatted = formatted.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="highlight-number">$1</span>');

  // Highlight quoted strings
  formatted = formatted.replace(/"([^"]*)"/g, '"<span class="highlight-string">$1</span>"');

  // Highlight keywords based on level
  if (level) {
    const levelUpper = level.toUpperCase();
    if (levelUpper === 'ERROR' || levelUpper === 'FATAL') {
      formatted = formatted.replace(
        /\b(error|exception|failed|failure|fatal)\b/gi,
        '<span class="highlight-error">$1</span>'
      );
    } else if (levelUpper === 'WARN') {
      formatted = formatted.replace(
        /\b(warn|warning|deprecated)\b/gi,
        '<span class="highlight-warn">$1</span>'
      );
    }
  }

  return formatted;
}

// Format stack trace with line numbers and highlighting
function formatStackTrace(stackTrace: string): string {
  const lines = stackTrace.split('\n');
  const formatted = lines
    .map((line, index) => {
      let formattedLine = line;

      // Highlight file paths and line numbers
      formattedLine = formattedLine.replace(
        /\((.*?):(\d+):(\d+)\)/g,
        '(<span class="highlight-file">$1</span>:<span class="highlight-line">$2</span>:$3)'
      );

      // Highlight method names
      formattedLine = formattedLine.replace(
        /at\s+([A-Za-z0-9_$.]+)/g,
        'at <span class="highlight-method">$1</span>'
      );

      return `<span class="stack-line">${formattedLine}</span>`;
    })
    .join('\n');

  return formatted;
}

// Worker message handler
self.onmessage = (e: MessageEvent<HighlightRequest>) => {
  const { id, message, level, stackTrace } = e.data;

  try {
    // Generate cache key
    const cacheKey = hashString(message + (level || '') + (stackTrace || ''));

    // Check cache
    let result = formatCache.get(cacheKey);

    if (!result) {
      // Format the content
      const formattedMessage = formatMessage(message, level);
      const formattedStackTrace = stackTrace ? formatStackTrace(stackTrace) : undefined;

      result = { formattedMessage, formattedStackTrace };

      // Add to cache
      formatCache.set(cacheKey, result);

      // Limit cache size - remove 10% when exceeded to avoid spikes
      if (formatCache.size > MAX_CACHE_SIZE) {
        const removeCount = Math.floor(MAX_CACHE_SIZE * 0.1);
        const keysToDelete = Array.from(formatCache.keys()).slice(0, removeCount);
        keysToDelete.forEach((key) => formatCache.delete(key));
      }
    }

    // Send response
    const response: HighlightResponse = {
      id,
      ...result,
    };

    self.postMessage(response);
  } catch (error) {
    // Send error response
    const response: HighlightResponse = {
      id,
      formattedMessage: message, // Fallback to original
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
  }
};

// Export types for use in main thread
export type { HighlightRequest, HighlightResponse };
