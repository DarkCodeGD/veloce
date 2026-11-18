/**
 * JSON helpers: deep equality, JSON Merge Patch (RFC 7386) and its inverse (`diffPatch`).
 *
 * Merge patch is how every partial update works (`node.update`, `slide.update`, …):
 *   - objects merge recursively, arrays and primitives are replaced,
 *   - `null` deletes a field (so stored documents never contain `null`).
 *
 * One deliberate extension, the "discriminator rule": when a patch changes the variant of a
 * tagged object known to core (layout `mode`, paint `type`), the object is replaced instead of
 * merged. Otherwise `{ mode: "grid" }` merged into a stack layout would keep stack-only keys.
 */

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Structural equality for JSON-like values. Keys holding `undefined` count as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** Tag values whose change means "this is a different kind of object, replace it". */
const DISCRIMINATORS: ReadonlyArray<readonly [key: string, values: ReadonlySet<string>]> = [
  ["mode", new Set(["stack", "grid", "absolute"])],
  ["type", new Set(["linear-gradient", "radial-gradient", "image"])],
];

function variantChanged(target: JsonObject, patch: JsonObject): boolean {
  return DISCRIMINATORS.some(([key, values]) => {
    const next = patch[key];
    return typeof next === "string" && values.has(next) && target[key] !== next;
  });
}

/**
 * Keys that could change an object's prototype when assigned. Patches come from the network
 * and from AI agents, so they're dropped (`JSON.parse` happily creates an own "__proto__" key).
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Apply a JSON Merge Patch. Pure: never mutates `target` or `patch`. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const base = isPlainObject(target) && !variantChanged(target, patch) ? target : {};
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || UNSAFE_KEYS.has(key)) continue;
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

/**
 * The smallest merge patch that turns `from` into `to`, or `undefined` if they're equal.
 * Guarantee: `deepEqual(mergePatch(from, diffPatch(from, to)), to)`, given `to` has no nulls.
 * Used to compute the inverse of an update for undo.
 */
export function diffPatch(from: unknown, to: unknown): unknown {
  if (deepEqual(from, to)) return undefined;
  if (!isPlainObject(from) || !isPlainObject(to) || variantChanged(from, to)) return to;
  const patch: JsonObject = {};
  for (const key of Object.keys(from)) {
    if (from[key] !== undefined && to[key] === undefined) patch[key] = null;
  }
  for (const [key, value] of Object.entries(to)) {
    if (value === undefined) continue;
    const inner = diffPatch(from[key], value);
    if (inner !== undefined) patch[key] = inner;
  }
  return patch;
}
