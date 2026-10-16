import * as fs from "fs";
import * as path from "path";
import { AsyncFileWriter, type FileWriterQueueLimits } from "./AsyncFileWriter";
import { estimatePayloadBytes } from "../utils/estimatePayloadBytes";
import { textChunks } from "../utils/textChunks";

const RECORD_BUFFER_BYTES = 1024 * 1024;

export interface FileLoggingConfiguration {
  enabled: boolean;
  filepath: string;
  maxBytes: number;
  maxBackups: number;
}

/** Configuration, rotation and writes share the writer's single serial queue. */
export class FileLoggingService extends AsyncFileWriter {
  private configuration: FileLoggingConfiguration | null = null;
  private initialized = false;
  private fileBytes = 0;

  constructor(limits: FileWriterQueueLimits = {}) {
    super("", limits);
  }

  configure(configuration: FileLoggingConfiguration): Promise<void> {
    const snapshot = { ...configuration };
    return this.enqueueOperation(async () => {
      if (
        !this.configuration ||
        this.configuration.filepath !== snapshot.filepath ||
        this.configuration.enabled !== snapshot.enabled
      ) {
        this.initialized = false;
      }
      this.configuration = snapshot;
      this.filepath = snapshot.filepath;
      if (snapshot.enabled) await this.initialize();
    });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.promises.mkdir(path.dirname(this.filepath), { recursive: true });
    const handle = await fs.promises.open(this.filepath, "a");
    try {
      this.fileBytes = (await handle.stat()).size;
    } finally {
      await handle.close();
    }
    this.initialized = true;
  }

  protected override async writeData(
    data: string | Uint8Array,
    bytes: number,
  ): Promise<void> {
    const config = this.configuration;
    if (!config?.enabled) return;
    await this.initialize();
    if (this.fileBytes + bytes > config.maxBytes) {
      await this.rotateFile(config.maxBackups);
    }
    await this.appendData(data, bytes);
  }

  writeRecord(record: Record<string, unknown>): Promise<void> {
    return this.writeRecords([record]);
  }

  /** Serialize after admission; records cannot interleave or rotate between chunks. */
  writeRecords(records: readonly Record<string, unknown>[]): Promise<void> {
    const bufferBytes = Math.max(
      1,
      Math.floor(
        Math.min(
          RECORD_BUFFER_BYTES,
          this.maxQueuedBytes,
          estimatePayloadBytes(records, RECORD_BUFFER_BYTES),
        ),
      ),
    );
    return this.enqueueWrite(async () => {
      const config = this.configuration;
      if (!config?.enabled) return;
      let pending: string[] = [];
      let pendingBytes = 0;
      const flush = async () => {
        if (!pending.length) return;
        await this.writeData(pending.join(""), pendingBytes);
        pending = [];
        pendingBytes = 0;
      };
      for (const record of records) {
        const serialized = JSON.stringify(record);
        if (serialized === undefined)
          throw new TypeError("Log record could not be serialized");
        const data = serialized + "\n";
        const bytes = Buffer.byteLength(data, "utf8");
        if (bytes <= bufferBytes) {
          if (pendingBytes + bytes > bufferBytes) await flush();
          pending.push(data);
          pendingBytes += bytes;
          continue;
        }
        await flush();
        await this.initialize();
        if (this.fileBytes + bytes > config.maxBytes)
          await this.rotateFile(config.maxBackups);
        for (const text of textChunks(
          data,
          Math.max(2, Math.floor(bufferBytes / 3)),
        )) {
          const encoded = Buffer.from(text, "utf8");
          for (let offset = 0; offset < encoded.length; offset += bufferBytes) {
            const chunk = encoded.subarray(offset, offset + bufferBytes);
            await this.appendData(chunk, chunk.byteLength);
          }
        }
      }
      await flush();
    }, bufferBytes);
  }

  private async appendData(
    data: string | Uint8Array,
    bytes: number,
  ): Promise<void> {
    try {
      await super.writeData(data, bytes);
      this.fileBytes += bytes;
    } catch (error) {
      // appendFile may have written a prefix before failing. Re-stat next time.
      this.initialized = false;
      throw error;
    }
  }

  rotate(): Promise<void> {
    return this.enqueueOperation(async () => {
      if (!this.configuration?.enabled) return;
      await this.initialize();
      await this.rotateFile(this.configuration.maxBackups);
    });
  }

  private async rotateFile(backups: number): Promise<void> {
    // Preserve the existing zero-backup behavior: append without truncating.
    if (backups < 1) return;
    for (let i = backups - 1; i >= 1; i--) {
      try {
        await fs.promises.rename(
          `${this.filepath}.${i}`,
          `${this.filepath}.${i + 1}`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await fs.promises.rename(this.filepath, `${this.filepath}.1`);
    this.initialized = false;
    await this.initialize();
  }
}
