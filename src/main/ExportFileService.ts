import { randomUUID } from "node:crypto";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { EXPORT_CHUNK_BYTES } from "../types/ipc";

export interface ExportOwner {
  isDestroyed(): boolean;
  once(
    event: "destroyed" | "render-process-gone",
    listener: () => void,
  ): unknown;
  removeListener(
    event: "destroyed" | "render-process-gone",
    listener: () => void,
  ): unknown;
}

interface Session {
  owner: ExportOwner;
  filePath: string;
  partialPath: string;
  handle?: FileHandle;
  created: boolean;
  canceled: boolean;
  nextChunk: number;
  active?: Promise<unknown>;
}

/** An export never modifies the destination until every acknowledged chunk is flushed. */
export class ExportFileService {
  private readonly sessions = new Map<string, Session>();
  private readonly owners = new Map<
    ExportOwner,
    { allowedPath?: string; destroyed: () => void }
  >();

  constructor(
    private readonly onCleanupError: (error: unknown) => void = console.error,
  ) {}

  authorize(owner: ExportOwner, filePath: string): void {
    if (owner.isDestroyed()) throw new Error("Export window was closed");
    if (!path.isAbsolute(filePath))
      throw new Error("Export path must be absolute");
    let state = this.owners.get(owner);
    if (!state) {
      const destroyed = (): void => {
        const state = this.owners.get(owner);
        if (state) state.allowedPath = undefined;
        for (const [id, session] of this.sessions) {
          if (session.owner === owner)
            void this.cancel(owner, id).catch(this.onCleanupError);
        }
        this.releaseOwner(owner);
      };
      state = { destroyed };
      this.owners.set(owner, state);
      owner.once("destroyed", destroyed);
      owner.once("render-process-gone", destroyed);
    }
    state.allowedPath = filePath;
  }

  async begin(owner: ExportOwner, filePath: string): Promise<string> {
    const state = this.owners.get(owner);
    if (!state || state.allowedPath !== filePath || owner.isDestroyed()) {
      throw new Error("Export path was not selected by this window");
    }
    state.allowedPath = undefined;
    const sessionId = randomUUID();
    const session: Session = {
      owner,
      filePath,
      partialPath: path.join(
        path.dirname(filePath),
        `.lumberjack-export-${sessionId}.part`,
      ),
      created: false,
      canceled: false,
      nextChunk: 0,
    };
    this.sessions.set(sessionId, session);
    await this.run(sessionId, session, async () => {
      session.handle = await open(session.partialPath, "wx", 0o600);
      session.created = true;
      this.checkAlive(session);
    });
    return sessionId;
  }

  async write(
    owner: ExportOwner,
    sessionId: string,
    chunkIndex: number,
    chunk: Uint8Array,
  ): Promise<void> {
    const session = this.owned(owner, sessionId);
    await this.run(sessionId, session, async () => {
      if (
        !Number.isSafeInteger(chunkIndex) ||
        chunkIndex !== session.nextChunk
      ) {
        throw new Error("Unexpected export chunk index");
      }
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.byteLength === 0 ||
        chunk.byteLength > EXPORT_CHUNK_BYTES
      ) {
        throw new Error("Invalid export chunk size or type");
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        this.checkAlive(session);
        const result = await session.handle!.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (result.bytesWritten === 0)
          throw new Error("Export write made no progress");
        offset += result.bytesWritten;
      }
      this.checkAlive(session);
      session.nextChunk++;
    });
  }

  async finish(
    owner: ExportOwner,
    sessionId: string,
    chunkCount: number,
  ): Promise<string> {
    const session = this.owned(owner, sessionId);
    await this.run(sessionId, session, async () => {
      if (
        !Number.isSafeInteger(chunkCount) ||
        chunkCount !== session.nextChunk
      ) {
        throw new Error("Export chunk count mismatch");
      }
      await session.handle!.sync();
      await session.handle!.close();
      session.handle = undefined;
      this.checkAlive(session);
      // Same-directory rename is the commit point, including when replacing an existing file.
      await rename(session.partialPath, session.filePath);
      session.created = false;
      this.sessions.delete(sessionId);
      this.releaseOwner(owner);
    });
    return session.filePath;
  }

  async cancel(owner: ExportOwner, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return; // Idempotent after a failed write has already cleaned up.
    if (session.owner !== owner)
      throw new Error("Export session belongs to another window");
    session.canceled = true;
    await session.active?.catch(() => undefined);
    await this.cleanup(sessionId, session);
  }

  private owned(owner: ExportOwner, sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown export session");
    if (session.owner !== owner)
      throw new Error("Export session belongs to another window");
    this.checkAlive(session);
    return session;
  }

  private checkAlive(session: Session): void {
    if (session.canceled || session.owner.isDestroyed())
      throw new Error("Export canceled");
  }

  private async run<T>(
    id: string,
    session: Session,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (session.active)
      throw new Error(
        "Export operation already in progress; await its acknowledgement",
      );
    const active = Promise.resolve()
      .then(operation)
      .catch(async (error: unknown) => {
        try {
          await this.cleanup(id, session);
        } catch (cleanupError) {
          throw new Error(
            `${String(error)}; export cleanup failed: ${String(cleanupError)}`,
            { cause: cleanupError },
          );
        }
        throw error;
      });
    session.active = active;
    try {
      return await active;
    } finally {
      session.active = undefined;
    }
  }

  private async cleanup(id: string, session: Session): Promise<void> {
    // Claim cleanup synchronously so destroy/cancel/error paths cannot close twice.
    const handle = session.handle;
    session.handle = undefined;
    const created = session.created;
    session.created = false;
    this.sessions.delete(id);
    this.releaseOwner(session.owner);
    try {
      await handle?.close();
    } finally {
      if (created) await unlink(session.partialPath);
    }
  }

  private releaseOwner(owner: ExportOwner): void {
    const state = this.owners.get(owner);
    if (!state || state.allowedPath) return;
    for (const session of this.sessions.values())
      if (session.owner === owner) return;
    owner.removeListener("destroyed", state.destroyed);
    owner.removeListener("render-process-gone", state.destroyed);
    this.owners.delete(owner);
  }
}
