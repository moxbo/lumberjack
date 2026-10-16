/** Split text without encoding a surrogate pair as two replacement characters. */
export function* textChunks(
  text: string,
  maxChars = 64 * 1024,
): Generator<string> {
  if (!Number.isSafeInteger(maxChars) || maxChars < 2)
    throw new RangeError("Text chunk length must be at least two characters");
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChars, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield text.slice(start, end);
    start = end;
  }
}
