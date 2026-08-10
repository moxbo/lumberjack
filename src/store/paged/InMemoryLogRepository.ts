import {
  hydratePagedRecord,
  preparePagedRecord,
  type CanonicalLogEntry,
  type PagedLogEntry,
  type ProjectionRecord,
  type ProjectionScanOptions,
} from "./types";

export class InMemoryLogRepository {
  readonly databaseName = "";

  private payloadMap = new Map<number, CanonicalLogEntry>();
  private projectionMap = new Map<number, ProjectionRecord>();
  private signatureSet = new Set<string>();
  private nextId = 1;
  private mutationTail: Promise<void> = Promise.resolve();

  isAvailable(): boolean {
    return true;
  }

  async clear(): Promise<void> {
    await this.runMutation(async () => {
      this.payloadMap.clear();
      this.projectionMap.clear();
      this.signatureSet.clear();
      this.nextId = 1;
    });
  }

  async destroy(): Promise<void> {
    await this.clear();
  }

  async findExistingSignatures(
    candidates: readonly { source: string; signature: string }[],
  ): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.source}\0${candidate.signature}`;
      if (this.signatureSet.has(key)) existing.add(key);
    }
    return existing;
  }

  async putMany(entries: readonly PagedLogEntry[]): Promise<number[]> {
    if (entries.length === 0) return [];
    return this.runMutation(async () => {
      const ids = entries.map((entry) => {
        const supplied = entry.id ?? entry._id;
        if (supplied !== undefined) {
          if (!Number.isSafeInteger(supplied) || supplied < 1) {
            throw new RangeError(
              "Paged log entry IDs must be positive safe integers",
            );
          }
          this.nextId = Math.max(this.nextId, supplied + 1);
          return supplied;
        }
        return this.nextId++;
      });

      for (let index = 0; index < entries.length; index++) {
        const record = preparePagedRecord(entries[index]!, ids[index]!);
        this.payloadMap.set(
          ids[index]!,
          hydratePagedRecord(record.payload.entry, record.projection),
        );
        this.projectionMap.set(ids[index]!, record.projection);
        this.signatureSet.add(
          `${record.projection.source}\0${record.projection.signature}`,
        );
      }

      return ids;
    });
  }

  async getPayload(id: number): Promise<CanonicalLogEntry | undefined> {
    return this.payloadMap.get(id);
  }

  async getPayloads(
    ids: readonly number[],
  ): Promise<Map<number, CanonicalLogEntry>> {
    const payloads = new Map<number, CanonicalLogEntry>();
    for (const id of ids) {
      const entry = this.payloadMap.get(id);
      if (entry) payloads.set(id, entry);
    }
    return payloads;
  }

  async scanProjections(
    callback: (
      page: readonly ProjectionRecord[],
    ) => void | boolean | Promise<void | boolean>,
    options: ProjectionScanOptions = {},
  ): Promise<void> {
    const pageSize = options.pageSize ?? 256;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new RangeError("Projection scan pageSize must be positive");
    }
    const ids = Array.from(this.projectionMap.keys()).sort((a, b) => a - b);
    for (let start = 0; start < ids.length; start += pageSize) {
      const page = ids
        .slice(start, start + pageSize)
        .map((id) => this.projectionMap.get(id))
        .filter((record): record is ProjectionRecord => record !== undefined);
      if ((await callback(page)) === false) return;
    }
  }

  async getProjections(
    ids: readonly number[],
  ): Promise<Map<number, ProjectionRecord>> {
    const projections = new Map<number, ProjectionRecord>();
    for (const id of ids) {
      const entry = this.projectionMap.get(id);
      if (entry) projections.set(id, entry);
    }
    return projections;
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.mutationTail.then(operation);
    this.mutationTail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}
