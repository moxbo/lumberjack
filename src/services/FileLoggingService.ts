import * as fs from "fs";
import * as path from "path";
import { AsyncFileWriter, type FileWriterQueueLimits } from "./AsyncFileWriter";

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
    data: string,
    bytes: number,
  ): Promise<void> {
    const config = this.configuration;
    if (!config?.enabled) return;
    await this.initialize();
    if (this.fileBytes + bytes > config.maxBytes) {
      await this.rotateFile(config.maxBackups);
    }
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
