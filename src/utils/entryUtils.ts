/**
 * Utility functions for log entry management
 */

import { compareByTimestampId } from "./sort";

/**
 * Entry signature for deduplication (without _id, since that's assigned later)
 */
export function entrySignatureForMerge(e: any): string {
  if (!e) return "";
  const ts = e?.timestamp != null ? String(e.timestamp) : "";
  const lg = e?.logger != null ? String(e.logger) : "";
  const msg = e?.message != null ? String(e.message) : "";
  const src = e?.source != null ? String(e.source) : "";
  return `${ts}|${lg}|${msg}|${src}`;
}

/**
 * Entry signature for marking (more concise, used for marks persistence)
 */
export function entrySignature(e: any): string {
  const ts = e?.timestamp != null ? String(e.timestamp) : "";
  const lg = e?.logger != null ? String(e.logger) : "";
  const msg = e?.message != null ? String(e.message) : "";
  return `${ts}|${lg}|${msg}`;
}

/**
 * Efficient merge function for sorted arrays - O(n+m) instead of O(n log n)
 * Assumes both prevSorted and newSorted are already sorted by compareByTimestampId
 * Now also deduplicates based on entry signature
 */
export function mergeSorted(prevSorted: any[], newSorted: any[]): any[] {
  if (newSorted.length === 0) return prevSorted;
  if (prevSorted.length === 0) return newSorted;

  // Build a Set of existing signatures for O(1) lookup
  const existingSigs = new Set<string>();
  for (const e of prevSorted) {
    existingSigs.add(entrySignatureForMerge(e));
  }

  const result: any[] = [];
  let i = 0,
    j = 0;

  while (i < prevSorted.length && j < newSorted.length) {
    if (compareByTimestampId(prevSorted[i], newSorted[j]) <= 0) {
      result.push(prevSorted[i]);
      i++;
    } else {
      // Only add new entry if not a duplicate
      const sig = entrySignatureForMerge(newSorted[j]);
      if (!existingSigs.has(sig)) {
        result.push(newSorted[j]);
        existingSigs.add(sig);
      }
      j++;
    }
  }

  // Add remaining elements from prevSorted
  while (i < prevSorted.length) {
    result.push(prevSorted[i]);
    i++;
  }

  // Add remaining elements from newSorted (with dedup check)
  while (j < newSorted.length) {
    const sig = entrySignatureForMerge(newSorted[j]);
    if (!existingSigs.has(sig)) {
      result.push(newSorted[j]);
      existingSigs.add(sig);
    }
    j++;
  }

  return result;
}

/**
 * Check if entry is from Elasticsearch source
 */
export function isElasticSource(e: any): boolean {
  return typeof e?.source === "string" && e.source.startsWith("elastic://");
}

/**
 * Check if entry is from file source (no schema)
 */
export function isFileSource(e: any): boolean {
  const s = e?.source;
  return typeof s === "string" && !s.includes("://");
}

/**
 * Check if entry is from HTTP source
 */
export function isHttpSource(e: any): boolean {
  const s = e?.source;
  return (
    typeof s === "string" &&
    (s.startsWith("http://") || s.startsWith("https://"))
  );
}
