import { compileMessageExpression } from "../utils/msgFilter";
import {
  decodeMessageSearchText,
  findMessageTerm,
  type SearchableMessagePage,
} from "../store/paged/messageSearchIndex";

const MAX_CACHED_TERM_BYTES = 16 * 1024 * 1024;

/** Reuses exact literal matches across AND/OR/NOT expressions, bounded by bytes. */
export class MessageTermCache {
  private readonly entries = new Map<string, Uint8Array>();
  private bytes = 0;

  constructor(private readonly maxBytes = MAX_CACHED_TERM_BYTES) {}

  get retainedBytes(): number {
    return this.bytes;
  }

  get(revision: string, term: string): Uint8Array | undefined {
    const key = `${revision}\0${term}`;
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  put(revision: string, term: string, flags: Uint8Array): void {
    const key = `${revision}\0${term}`;
    const size = flags.byteLength + key.length * 2 + 128;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.byteLength + key.length * 2 + 128;
      this.entries.delete(key);
    }
    if (size > this.maxBytes) return;
    while (this.bytes + size > this.maxBytes) {
      const oldest = this.entries.entries().next().value!;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].byteLength + oldest[0].length * 2 + 128;
    }
    this.entries.set(key, flags);
    this.bytes += size;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

export class MessagePageQuery {
  private readonly terms: string[] = [];
  private flags: Uint8Array[] = [];
  private readonly matches: (row: number) => boolean;

  constructor(expression: string) {
    this.matches = compileMessageExpression<number>(expression, (literal) => {
      const term = literal.toLowerCase();
      let index = this.terms.indexOf(term);
      if (index < 0) {
        index = this.terms.length;
        this.terms.push(term);
      }
      return (row) => this.flags[index]![row] === 1;
    });
  }

  async match(
    page: SearchableMessagePage,
    cache: MessageTermCache,
  ): Promise<Uint8Array> {
    let text: string | undefined;
    this.flags = [];
    for (const term of this.terms) {
      let flags = cache.get(page.revision, term);
      if (!flags) {
        text ??= await decodeMessageSearchText(page);
        flags = findMessageTerm(text, page.offsets, term);
        cache.put(page.revision, term, flags);
      }
      this.flags.push(flags);
    }
    const result = new Uint8Array(page.ids.length);
    for (let row = 0; row < result.length; row++) {
      if (this.matches(row)) result[row] = 1;
    }
    return result;
  }
}
