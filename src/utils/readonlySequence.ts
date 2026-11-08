export interface ReadonlySequence<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
  slice(start?: number, end?: number): T[];
  indexOf(value: T, fromIndex?: number): number;
  map<U>(callback: (value: T, index: number) => U): U[];
  filter(callback: (value: T, index: number) => unknown): T[];
  find(callback: (value: T, index: number) => unknown): T | undefined;
  flatMap<U>(callback: (value: T, index: number) => U | readonly U[]): U[];
  forEach(callback: (value: T, index: number) => void): void;
}

export abstract class BoundedSequence<T> implements ReadonlySequence<T> {
  abstract readonly length: number;
  abstract at(index: number): T | undefined;

  *[Symbol.iterator](): IterableIterator<T> {
    for (let index = 0; index < this.length; index++) yield this.at(index)!;
  }

  slice(start = 0, end = this.length): T[] {
    const normalize = (index: number) =>
      Math.min(
        this.length,
        Math.max(
          0,
          index < 0 ? this.length + Math.trunc(index) : Math.trunc(index),
        ),
      );
    const result: T[] = [];
    for (let index = normalize(start); index < normalize(end); index++)
      result.push(this.at(index)!);
    return result;
  }

  indexOf(value: T, fromIndex = 0): number {
    for (
      let index = Math.max(
        0,
        fromIndex < 0 ? this.length + fromIndex : fromIndex,
      );
      index < this.length;
      index++
    ) {
      if (this.at(index) === value) return index;
    }
    return -1;
  }

  map<U>(callback: (value: T, index: number) => U): U[] {
    const result: U[] = [];
    this.forEach((value, index) => result.push(callback(value, index)));
    return result;
  }

  filter(callback: (value: T, index: number) => unknown): T[] {
    const result: T[] = [];
    this.forEach((value, index) => {
      if (callback(value, index)) result.push(value);
    });
    return result;
  }

  find(callback: (value: T, index: number) => unknown): T | undefined {
    let index = 0;
    for (const value of this) if (callback(value, index++)) return value;
    return undefined;
  }

  flatMap<U>(callback: (value: T, index: number) => U | readonly U[]): U[] {
    const result: U[] = [];
    this.forEach((value, index) => {
      const mapped = callback(value, index);
      if (Array.isArray(mapped)) result.push(...mapped);
      else result.push(mapped as U);
    });
    return result;
  }

  forEach(callback: (value: T, index: number) => void): void {
    let index = 0;
    for (const value of this) callback(value, index++);
  }

  toArray(): T[] {
    return this.slice();
  }
}

export class MappedSequence<T, U> extends BoundedSequence<U> {
  readonly length: number;

  constructor(
    private readonly source: ReadonlySequence<T>,
    private readonly project: (value: T, index: number) => U,
  ) {
    super();
    this.length = source.length;
  }

  at(index: number): U | undefined {
    if (index < 0) index += this.length;
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      return undefined;
    return this.project(this.source.at(index)!, index);
  }
}
