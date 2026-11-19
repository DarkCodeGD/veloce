/**
 * JSON helpers: deep equality, JSON Merge Patch (RFC 7386) and its inverse (`diffPatch`).
 *
 * Merge patch is how every partial update works (`node.update`, `slide.update`, …):
 *   - objects merge recursively, arrays and primitives are replaced,
 *   - `null` deletes a field (so stored documents never contain `null`).
 *
 * Two deliberate extensions, both "a different kind of object is replaced, not merged":
 *   - the discriminator rule: when a patch changes the variant of a tagged object known to
 *     core (layout `mode`, paint `type`). Otherwise `{ mode: "grid" }` merged into a stack
 *     layout would keep stack-only keys.
 *   - the shape rule: for fields whose object forms have no tag but disjoint keys (`padding`
 *     is `{ x, y }` or `{ top, right, bottom, left }`), a patch written in the other form.
 *     Otherwise switching forms yields `{ x, y, top, … }`, which matches no form at all.
 * `diffPatch` applies the same rules, so undo inverses stay exact.
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

/** Untagged fields, by name, whose object forms are told apart by their keys. */
const SHAPES: ReadonlyMap<string, ReadonlyArray<ReadonlySet<string>>> = new Map([
  ["padding", [new Set(["x", "y"]), new Set(["top", "right", "bottom", "left"])]],
]);

/** Which of `forms` an object uses (by its first non-null key that belongs to one), or -1. */
function formOf(forms: ReadonlyArray<ReadonlySet<string>>, value: JsonObject): number {
  for (const [key, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    const form = forms.findIndex((f) => f.has(key));
    if (form >= 0) return form;
  }
  return -1;
}

/** Whether `patch` describes a different kind of object than `target` (see the header). */
function variantChanged(target: JsonObject, patch: JsonObject, field?: string): boolean {
  const tagged = DISCRIMINATORS.some(([key, values]) => {
    const next = patch[key];
    return typeof next === "string" && values.has(next) && target[key] !== next;
  });
  if (tagged) return true;
  const forms = field === undefined ? undefined : SHAPES.get(field);
  if (!forms) return false;
  const from = formOf(forms, target);
  const to = formOf(forms, patch);
  return from >= 0 && to >= 0 && from !== to;
}

/**
 * Keys that could change an object's prototype when assigned. Patches come from the network
 * and from AI agents, so they're dropped (`JSON.parse` happily creates an own "__proto__" key).
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Apply a JSON Merge Patch. Pure: never mutates `target` or `patch`. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  return merge(target, patch);
}

/** `field`: the key this value sits under (the shape rule is per field). */
function merge(target: unknown, patch: unknown, field?: string): unknown {
  if (!isPlainObject(patch)) return patch;
  const base = isPlainObject(target) && !variantChanged(target, patch, field) ? target : {};
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || UNSAFE_KEYS.has(key)) continue;
    if (value === null) delete out[key];
    else out[key] = merge(out[key], value, key);
  }
  return out;
}

/**
 * The smallest merge patch that turns `from` into `to`, or `undefined` if they're equal.
 * Guarantee: `deepEqual(mergePatch(from, diffPatch(from, to)), to)`, given `to` has no nulls.
 * Used to compute the inverse of an update for undo.
 */
export function diffPatch(from: unknown, to: unknown): unknown {
  return diff(from, to);
}

function diff(from: unknown, to: unknown, field?: string): unknown {
  if (deepEqual(from, to)) return undefined;
  if (!isPlainObject(from) || !isPlainObject(to) || variantChanged(from, to, field)) return to;
  const patch: JsonObject = {};
  for (const key of Object.keys(from)) {
    if (from[key] !== undefined && to[key] === undefined) patch[key] = null;
  }
  for (const [key, value] of Object.entries(to)) {
    if (value === undefined) continue;
    const inner = diff(from[key], value, key);
    if (inner !== undefined) patch[key] = inner;
  }
  return patch;
}
