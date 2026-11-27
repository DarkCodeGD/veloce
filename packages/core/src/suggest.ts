/**
 * "Did you mean…?" helpers, so a typo'd ID turns into a one-shot fix instead of a guessing game.
 */

/** Classic edit distance (insert/delete/substitute), O(a·b) time, O(b) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

/**
 * The closest candidates to `input` (only those tied for the best distance, up to `max`).
 * Listing a clearly-worse runner-up ("card-1-title" for "card-2-titel") only adds noise.
 */
export function suggest(input: string, candidates: Iterable<string>, max = 3): string[] {
  const threshold = Math.max(2, Math.floor(input.length / 3));
  const close = [...new Set(candidates)]
    .map((candidate) => ({ candidate, distance: levenshtein(input, candidate) }))
    .filter(({ distance }) => distance <= threshold);
  const best = Math.min(...close.map((c) => c.distance));
  return close
    .filter(({ distance }) => distance === best)
    .sort((a, b) => a.candidate.localeCompare(b.candidate))
    .slice(0, max)
    .map(({ candidate }) => candidate);
}

/** `"Did you mean "title"?"`, or a short list of valid values when nothing is close. */
export function notFoundHint(input: string, candidates: readonly string[], what: string): string {
  const close = suggest(input, candidates);
  if (close.length) {
    const guess = `Did you mean ${close.map((c) => `"${c}"`).join(" or ")}?`;
    // Several equally close ("s8" → s1, s2, s3): show them all when there are few.
    const all =
      close.length > 1 && candidates.length <= 15
        ? ` All ${what} IDs: ${candidates.map((c) => `"${c}"`).join(", ")}.`
        : "";
    return `${guess}${all}`;
  }
  if (!candidates.length) return `There are no ${what}s yet.`;
  const shown = candidates.slice(0, 15).map((c) => `"${c}"`);
  const more =
    candidates.length > shown.length ? ` (+${candidates.length - shown.length} more)` : "";
  return `Valid ${what} IDs: ${shown.join(", ")}${more}.`;
}
