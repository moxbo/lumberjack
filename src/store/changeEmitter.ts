export function createChangeEmitter(
  onListenerError?: (error: unknown) => void,
) {
  const listeners = new Set<() => void>();
  return {
    on(listener: () => void): () => void {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(): void {
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          onListenerError?.(error);
        }
      }
    },
  };
}
