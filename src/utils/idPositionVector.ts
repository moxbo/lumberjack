const SEGMENT_SIZE = 4096;

/** Sparse allocation of compact dense-ID pages; growing never copies old pages. */
export class IdPositionVector {
  private readonly segments = new Map<number, Float64Array>();

  get(id: number): number {
    if (!Number.isSafeInteger(id) || id < 0) return -1;
    return (
      (this.segments.get(Math.floor(id / SEGMENT_SIZE))?.[id % SEGMENT_SIZE] ??
        0) - 1
    );
  }

  set(id: number, position: number): void {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new Error(`Invalid metadata ID: ${id}`);
    }
    const segmentIndex = Math.floor(id / SEGMENT_SIZE);
    let segment = this.segments.get(segmentIndex);
    if (!segment) {
      segment = new Float64Array(SEGMENT_SIZE);
      this.segments.set(segmentIndex, segment);
    }
    segment[id % SEGMENT_SIZE] = position + 1;
  }
}
