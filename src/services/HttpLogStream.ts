import { StringDecoder } from "string_decoder";

export interface HttpLogBatch {
  text: string;
  jsonArray: boolean;
}

/**
 * Frame lines or top-level JSON array elements without retaining the response.
 * The limit applies to a single record, never to the complete download.
 */
export async function* httpLogBatches(
  chunks: AsyncIterable<Uint8Array>,
  maxRecordBytes: number,
  batchSize = 100,
): AsyncGenerator<HttpLogBatch> {
  const decoder = new StringDecoder("utf8");
  let mode: "lines" | "array" | undefined;
  let record = "";
  let recordBytes = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let closed = false;
  let afterComma = false;
  let records: string[] = [];
  let batchBytes = 0;

  const append = (text: string): void => {
    recordBytes += Buffer.byteLength(text);
    if (recordBytes > maxRecordBytes) {
      throw new Error(
        `HTTP log record too large (max: ${maxRecordBytes} bytes)`,
      );
    }
    record += text;
  };
  const finishRecord = (): void => {
    const text = record.trim();
    if (mode === "array") {
      if (!text) throw new Error("Invalid JSON array: missing element");
      // Validate before delivery: the existing file parser falls back on errors.
      JSON.parse(text);
    }
    if (text) {
      records.push(record);
      batchBytes += recordBytes;
    }
    record = "";
    recordBytes = 0;
  };
  const takeBatch = (): HttpLogBatch => {
    const text =
      mode === "array" ? `[${records.join(",")}]` : records.join("\n");
    records = [];
    batchBytes = 0;
    return { text, jsonArray: mode === "array" };
  };

  async function* decoded(): AsyncGenerator<string> {
    for await (const chunk of chunks) {
      yield decoder.write(Buffer.from(chunk));
    }
    yield decoder.end();
  }

  for await (const text of decoded()) {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      if (!mode) {
        if (/\s/.test(char)) {
          if (char === "\n") {
            record = "";
            recordBytes = 0;
            start = i + 1;
          }
          continue;
        }
        mode = char === "[" ? "array" : "lines";
        if (mode === "array") {
          record = "";
          recordBytes = 0;
          start = i + 1;
          continue;
        }
      }
      if (mode === "lines") {
        if (char !== "\n") continue;
        append(text.slice(start, i));
        if (record.endsWith("\r")) {
          record = record.slice(0, -1);
          recordBytes--;
        }
        finishRecord();
        start = i + 1;
      } else {
        if (closed) {
          if (!/\s/.test(char)) {
            throw new Error("Invalid JSON array: trailing content");
          }
          start = i + 1;
          continue;
        }
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || (char === "]" && depth > 0)) depth--;
        else if (depth === 0 && (char === "," || char === "]")) {
          append(text.slice(start, i));
          if (char === "," || record.trim() || afterComma) finishRecord();
          else {
            record = "";
            recordBytes = 0;
          }
          afterComma = char === ",";
          closed = char === "]";
          start = i + 1;
        } else continue;
        if (depth < 0) throw new Error("Invalid JSON array: unmatched bracket");
        if (char !== "," && !closed) continue;
      }
      if (records.length >= batchSize || batchBytes >= 1024 * 1024) {
        yield takeBatch();
      }
    }
    append(text.slice(start));
  }
  if (mode === "array") {
    if (!closed) throw new Error("Invalid JSON array: incomplete response");
  } else if (record.trim()) finishRecord();
  if (records.length) yield takeBatch();
}
