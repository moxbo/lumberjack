import type { PagedTimestamp, ProjectionRecord } from "./types";

export const MESSAGE_SEARCH_PAGE_SIZE = 2_000;
export const MAX_MESSAGE_SEARCH_CHARS = 2 * 1024 * 1024;
const VERSION = 1;
// Vite defines this for the renderer; standalone browser bundles use gzip.
declare const __BENCH_PLAIN_MESSAGE_INDEX__: boolean;
const useGzip =
  typeof __BENCH_PLAIN_MESSAGE_INDEX__ === "undefined" ||
  !__BENCH_PLAIN_MESSAGE_INDEX__;

export type IndexedMessage = Pick<
  ProjectionRecord,
  "id" | "timestamp" | "message"
>;

interface MessageSearchPageHeader {
  id: number;
  version: number;
  revision: string;
}

export type MessageSearchPage =
  | (MessageSearchPageHeader & { omitted: true })
  | (MessageSearchPageHeader & {
      omitted: false;
      ids: Float64Array;
      timestamps: PagedTimestamp[];
      offsets: Uint32Array;
      text: string | Uint8Array;
    });

export type SearchableMessagePage = Extract<
  MessageSearchPage,
  { omitted: false }
>;

export function messageSearchPageId(id: number): number {
  return (
    Math.floor((id - 1) / MESSAGE_SEARCH_PAGE_SIZE) * MESSAGE_SEARCH_PAGE_SIZE +
    1
  );
}

export function omittedMessageSearchPage(id: number): MessageSearchPage {
  return { id, version: VERSION, revision: crypto.randomUUID(), omitted: true };
}

/** Only normalized search text and result references, never raw payloads or MDC. */
export async function buildMessageSearchPage(
  pageId: number,
  records: readonly IndexedMessage[],
): Promise<MessageSearchPage> {
  if (
    !Number.isSafeInteger(pageId) ||
    pageId < 1 ||
    messageSearchPageId(pageId) !== pageId
  ) {
    throw new Error("Invalid message search page ID");
  }
  let length = 0;
  const messages: string[] = [];
  const offsets = new Uint32Array(records.length + 1);
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (
      !Number.isSafeInteger(record.id) ||
      record.id < pageId ||
      record.id >= pageId + MESSAGE_SEARCH_PAGE_SIZE ||
      (index > 0 && record.id <= records[index - 1]!.id)
    ) {
      throw new Error(
        "Message search page requires sorted, unique IDs in its range",
      );
    }
    const message = record.message.toLowerCase();
    length += message.length;
    // Extremely large pages use the authoritative projection scan instead.
    if (length > MAX_MESSAGE_SEARCH_CHARS)
      return omittedMessageSearchPage(pageId);
    messages.push(message);
    offsets[index + 1] = length;
  }
  const packed = messages.join("");
  let text: string | Uint8Array = packed;
  if (
    useGzip &&
    packed.length >= 16 * 1024 &&
    typeof CompressionStream !== "undefined"
  ) {
    // JSON preserves lone UTF-16 surrogates as well as ordinary Unicode text.
    const compressed = new Uint8Array(
      await new Response(
        new Blob([JSON.stringify(packed)])
          .stream()
          .pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    if (compressed.byteLength < packed.length) text = compressed;
  }
  return {
    id: pageId,
    version: VERSION,
    revision: crypto.randomUUID(),
    omitted: false,
    ids: Float64Array.from(records, (record) => record.id),
    timestamps: records.map((record) => record.timestamp),
    offsets,
    text,
  };
}

export function validateMessageSearchPage(page: MessageSearchPage): void {
  if (page.version !== VERSION) {
    throw new Error(
      `Unsupported message search index version: ${page.version}`,
    );
  }
  if (
    !Number.isSafeInteger(page.id) ||
    page.id < 1 ||
    messageSearchPageId(page.id) !== page.id ||
    typeof page.revision !== "string" ||
    !page.revision ||
    typeof page.omitted !== "boolean"
  ) {
    throw new Error("Invalid message search page header");
  }
  if (page.omitted) return;
  if (
    !(page.ids instanceof Float64Array) ||
    !(page.offsets instanceof Uint32Array) ||
    !Array.isArray(page.timestamps) ||
    (typeof page.text !== "string" && !(page.text instanceof Uint8Array)) ||
    page.ids.length > MESSAGE_SEARCH_PAGE_SIZE ||
    page.timestamps.length !== page.ids.length ||
    page.offsets.length !== page.ids.length + 1 ||
    page.offsets[0] !== 0 ||
    page.offsets[page.ids.length]! > MAX_MESSAGE_SEARCH_CHARS
  ) {
    throw new Error("Invalid message search page layout");
  }
  for (let index = 0; index < page.ids.length; index++) {
    const id = page.ids[index]!;
    if (
      !Number.isSafeInteger(id) ||
      id < page.id ||
      id >= page.id + MESSAGE_SEARCH_PAGE_SIZE ||
      (index > 0 && id <= page.ids[index - 1]!) ||
      page.offsets[index]! > page.offsets[index + 1]!
    ) {
      throw new Error("Invalid message search page boundaries");
    }
  }
}

export async function decodeMessageSearchText(
  page: SearchableMessagePage,
): Promise<string> {
  const stored = page.text;
  let text: unknown = stored;
  if (typeof stored !== "string") {
    const decoded = await new Response(
      new Blob([Uint8Array.from(stored).buffer])
        .stream()
        .pipeThrough(new DecompressionStream("gzip")),
    ).text();
    text = JSON.parse(decoded);
  }
  if (
    typeof text !== "string" ||
    text.length !== page.offsets[page.ids.length]
  ) {
    throw new Error("Invalid message search text length");
  }
  return text;
}

/** Finds a literal across a packed column without allowing cross-row matches. */
export function findMessageTerm(
  text: string,
  offsets: Uint32Array,
  needle: string,
): Uint8Array {
  const flags = new Uint8Array(offsets.length - 1);
  if (!needle) return flags.fill(1);
  let row = 0;
  let position = 0;
  while ((position = text.indexOf(needle, position)) !== -1) {
    while (row < flags.length && offsets[row + 1]! <= position) row++;
    if (row >= flags.length) break;
    if (position + needle.length <= offsets[row + 1]!) {
      flags[row] = 1;
      position = offsets[row + 1]!;
    } else {
      position++;
    }
  }
  return flags;
}
