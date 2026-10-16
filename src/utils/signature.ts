const MAX_SIGNATURE_MESSAGE_LENGTH = 10 * 1024;

interface SignatureEntry {
  timestamp?: unknown;
  logger?: unknown;
  message?: unknown;
  _fullMessage?: unknown;
  source?: unknown;
}

function signatureMessage(entry: SignatureEntry): string {
  const fullMessage = entry._fullMessage;
  let message =
    fullMessage == null ? String(entry.message ?? "") : String(fullMessage);
  if (message.length > MAX_SIGNATURE_MESSAGE_LENGTH) {
    message =
      message.slice(0, MAX_SIGNATURE_MESSAGE_LENGTH) +
      `[len:${message.length}]`;
  }
  return message;
}

export function legacyEntrySignature(entry: SignatureEntry): string {
  const timestamp = entry.timestamp == null ? "" : String(entry.timestamp);
  const logger = entry.logger == null ? "" : String(entry.logger);
  const message = signatureMessage(entry);
  return typeof entry.source === "string" &&
    entry.source.startsWith("elastic://")
    ? `${timestamp}|${logger}|${message}|${entry.source}`
    : `${timestamp}|${logger}|${message}`;
}

export function compactEntrySignature(entry: SignatureEntry): string {
  let h1 = 0x6a09e667;
  let h2 = 0xbb67ae85;
  let h3 = 0x3c6ef372;
  let h4 = 0xa54ff53a;

  const update = (value: string): void => {
    const length = value.length;
    for (let shift = 0; shift < 32; shift += 8) {
      const code = (length >>> shift) & 0xff;
      h1 = Math.imul(h1 ^ code, 0x85ebca6b);
      h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
      h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
      h4 = Math.imul(h4 ^ code, 0x165667b1);
    }
    for (let index = 0; index < length; index++) {
      const code = value.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 0x85ebca6b);
      h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
      h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
      h4 = Math.imul(h4 ^ code, 0x165667b1);
    }
  };

  update(entry.timestamp == null ? "" : String(entry.timestamp));
  update(entry.logger == null ? "" : String(entry.logger));
  update(signatureMessage(entry));
  if (
    typeof entry.source === "string" &&
    entry.source.startsWith("elastic://")
  ) {
    update(entry.source);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b) ^ h2;
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35) ^ h3;
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x27d4eb2f) ^ h4;
  h4 = Math.imul(h4 ^ (h4 >>> 13), 0x165667b1) ^ h1;

  const hex = (value: number): string =>
    (value >>> 0).toString(16).padStart(8, "0");
  return `v2:${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}`;
}
