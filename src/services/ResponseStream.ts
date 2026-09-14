/** Read only when the downstream consumer requests another bounded chunk. */
export async function* responseChunks(
  response: Response,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (!response.body) return;
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Response read aborted");
      let timer!: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Response read timed out")),
            timeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) return;
      for (
        let offset = 0;
        offset < result.value.byteLength;
        offset += 64 * 1024
      ) {
        if (signal?.aborted) throw new Error("Response read aborted");
        yield result.value.subarray(offset, offset + 64 * 1024);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
