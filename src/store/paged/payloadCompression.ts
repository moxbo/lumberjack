import type { PayloadRecord } from "./types";

export const PAYLOAD_COMPRESSION_THRESHOLD = 16 * 1024;
const COMPRESSION_CODEC = "gzip-json-v1";

export interface CompressedHeavyFields {
  codec: string;
  data: Uint8Array;
}

export type StoredPayloadEntry = PayloadRecord["entry"] & {
  _compressedHeavy?: CompressedHeavyFields;
};

function supportsCompression(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

async function transform(
  input: string | Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const blobPart =
    typeof input === "string" ? input : Uint8Array.from(input).buffer;
  const readable = new Blob([blobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(readable).arrayBuffer());
}

export async function compressPayloadEntry(
  input: PayloadRecord["entry"],
  threshold = PAYLOAD_COMPRESSION_THRESHOLD,
): Promise<StoredPayloadEntry> {
  const stackTrace =
    typeof input.stackTrace === "string" ? input.stackTrace : undefined;
  const fullMessage =
    typeof input._fullMessage === "string" ? input._fullMessage : undefined;
  if (
    !supportsCompression() ||
    (stackTrace?.length ?? 0) + (fullMessage?.length ?? 0) < threshold
  ) {
    return input;
  }

  const serialized = JSON.stringify({ stackTrace, _fullMessage: fullMessage });
  const encoded = new TextEncoder().encode(serialized);
  const compressed = await transform(serialized, new CompressionStream("gzip"));
  if (compressed.byteLength >= encoded.byteLength) return input;

  const output: StoredPayloadEntry = { ...input };
  if (stackTrace !== undefined) delete output.stackTrace;
  if (fullMessage !== undefined) delete output._fullMessage;
  output._compressedHeavy = {
    codec: COMPRESSION_CODEC,
    data: compressed,
  };
  return output;
}

export async function decompressPayloadEntry(
  input: StoredPayloadEntry,
): Promise<PayloadRecord["entry"]> {
  const compressed = input._compressedHeavy;
  if (!compressed) return input;
  if (compressed.codec !== COMPRESSION_CODEC) {
    throw new Error(
      `Unsupported payload compression codec: ${compressed.codec}`,
    );
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is unavailable");
  }

  const decoded = await transform(
    compressed.data,
    new DecompressionStream("gzip"),
  );
  const heavy = JSON.parse(new TextDecoder().decode(decoded)) as {
    stackTrace?: string;
    _fullMessage?: string;
  };
  const output: StoredPayloadEntry = { ...input };
  delete output._compressedHeavy;
  if (typeof heavy.stackTrace === "string") {
    output.stackTrace = heavy.stackTrace;
  }
  if (typeof heavy._fullMessage === "string") {
    output._fullMessage = heavy._fullMessage;
  }
  return output;
}
