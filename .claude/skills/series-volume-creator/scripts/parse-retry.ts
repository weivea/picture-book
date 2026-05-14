/**
 * Parse a free-text retry instruction into a sorted, deduplicated list of
 * page indices. `totalPages` is the page count of the volume (cover counts
 * as page 0, so valid range is [0, totalPages - 1]).
 *
 * Accepts mixed Chinese/English punctuation and ranges:
 *   "重试 5、9 页"     → [5, 9]
 *   "重试 3-6 页"      → [3, 4, 5, 6]
 *   "重试 3 至 6 页"   → [3, 4, 5, 6]
 *   "redo pages 1, 4-5"→ [1, 4, 5]
 *
 * Throws if no numbers are found, or any number/range is outside [0, totalPages - 1].
 */
export function parseRetrySpec(input: string, totalPages: number): number[] {
  // Normalize: replace Chinese commas with ASCII; replace 至 with -.
  const normalized = input
    .replace(/[，、]/g, ",")
    .replace(/\s*至\s*/g, "-")
    .replace(/\s+/g, " ");

  // Match either a range "a-b" or a single number.
  const tokens = normalized.match(/\d+\s*-\s*\d+|\d+/g);
  if (!tokens || tokens.length === 0) {
    throw new Error("no page numbers found in retry spec");
  }

  const pages = new Set<number>();
  for (const tok of tokens) {
    const rangeMatch = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      if (lo > hi) {
        throw new Error(`invalid range ${lo}-${hi}: low > high`);
      }
      for (let n = lo; n <= hi; n++) {
        assertInRange(n, totalPages);
        pages.add(n);
      }
    } else {
      const n = parseInt(tok, 10);
      assertInRange(n, totalPages);
      pages.add(n);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function assertInRange(n: number, totalPages: number): void {
  if (n < 0 || n >= totalPages) {
    throw new Error(`page ${n} out of range [0, ${totalPages - 1}]`);
  }
}
