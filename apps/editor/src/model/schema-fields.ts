/**
 * Inspector fields generated from an element plugin's props schema (golden rule #5: one zod
 * schema drives the inspector, MCP input, validation and docs). We read the schema's JSON Schema
 * form, which zod emits through a stable public API, and map each property to a control.
 */
import type { ElementDefinition } from "@veloce/plugin-api";
import { z } from "@veloce/plugin-api";

export type FieldKind =
  | { kind: "enum"; options: string[] }
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; integer: boolean; default?: number }
  | { kind: "token"; group: string }
  | { kind: "color" }
  /** A color, or a gradient/image (edited as a color here; gradients stay as they are). */
  | { kind: "paint" }
  /** Pixels or a `$space` / `$radius` token. */
  | { kind: "length"; group: string }
  | { kind: "text"; multiline: boolean }
  | { kind: "richText" }
  /** A deck asset (`"asset:<sha256>"`): shown with a preview, replaced by picking a file. */
  | { kind: "asset" }
  /** A line (`StrokeSchema`: color, width, style), edited like a frame's border. */
  | { kind: "stroke" }
  /**
   * A point (`{ x, y }`, fractions) on the picture of the schema's `asset` prop: an image's
   * focus. Dragged on a preview of that picture (D82).
   */
  | { kind: "focus"; asset: string }
  /**
   * A rectangle (`{ x, y, w, h }`, fractions) of the picture of the schema's `asset` prop:
   * an image's crop. Edited in crop mode on the canvas (D84).
   */
  | { kind: "crop"; asset: string }
  /** Not editable in the inspector yet (nested objects): shown read-only. */
  | { kind: "readonly" };

export type FieldSpec = FieldKind & { key: string; label: string };

type JsonSchema = {
  type?: string;
  pattern?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  maxLength?: number;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
};

const TOKEN_PATTERN = /^\^\\\$([a-z]+)\\\./;

/** `"verticalAlign"` → `"Vertical align"`. */
export function labelFor(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function flatten(s: JsonSchema): JsonSchema[] {
  const union = s.anyOf ?? s.oneOf; // zod emits discriminated unions as oneOf
  return union ? union.flatMap(flatten) : [s];
}

const tokenGroup = (s: JsonSchema) =>
  s.type === "string" && s.pattern ? (TOKEN_PATTERN.exec(s.pattern)?.[1] ?? null) : null;

/** `StrokeSchema`'s shape: an object of a color, a number width and an optional line style. */
function isStroke(s: JsonSchema): boolean {
  const p = s.properties;
  if (s.type !== "object" || !p?.color || !p.width) return false;
  const keys = Object.keys(p);
  return (
    keys.every((k) => k === "color" || k === "width" || k === "style") &&
    fieldKind(p.color).kind === "color" &&
    fieldKind(p.width).kind === "number"
  );
}

/** `PointSchema`'s shape: exactly a number `x` and a number `y`. */
function isPoint(s: JsonSchema): boolean {
  const p = s.properties;
  if (s.type !== "object" || !p?.x || !p.y || Object.keys(p).length !== 2) return false;
  return fieldKind(p.x).kind === "number" && fieldKind(p.y).kind === "number";
}

/** `CropSchema`'s shape: exactly numbers `x`, `y`, `w` and `h`. */
function isFractionRect(s: JsonSchema): boolean {
  const p = s.properties;
  const keys = ["x", "y", "w", "h"];
  if (s.type !== "object" || !p || Object.keys(p).length !== keys.length) return false;
  return keys.every((k) => p[k] !== undefined && fieldKind(p[k]).kind === "number");
}

export function fieldKind(s: JsonSchema): FieldKind {
  if (isStroke(s)) return { kind: "stroke" };
  const options = flatten(s);
  const isHex = (o: JsonSchema) => o.type === "string" && o.pattern?.startsWith("^#");
  if (options.some(isHex)) {
    return options.some((o) => o.type === "object") ? { kind: "paint" } : { kind: "color" };
  }
  if (options.length > 1) {
    const group = options.map(tokenGroup).find(Boolean);
    if (group && options.some((o) => o.type === "number")) return { kind: "length", group };
    if (options.some((o) => o.type === "string") && options.some((o) => o.type === "array")) {
      return { kind: "richText" };
    }
    const consts = options.map((o) => o.const);
    if (consts.every((c) => typeof c === "string"))
      return { kind: "enum", options: consts as string[] };
    return { kind: "readonly" };
  }
  const group = tokenGroup(s);
  if (group) return { kind: "token", group };
  if (s.type === "string" && s.pattern?.startsWith("^asset:")) return { kind: "asset" };
  if (s.type === "string" && s.enum) return { kind: "enum", options: s.enum.map(String) };
  if (s.type === "string" && !s.pattern)
    return { kind: "text", multiline: (s.maxLength ?? 0) > 200 };
  if (s.type === "boolean") return { kind: "boolean" };
  if (s.type === "number" || s.type === "integer") {
    const integer = s.type === "integer";
    // `.positive()` is an exclusive minimum: the smallest allowed value is just above it.
    const min =
      s.minimum ??
      (s.exclusiveMinimum === undefined ? undefined : s.exclusiveMinimum + (integer ? 1 : 0.01));
    return {
      kind: "number",
      integer,
      ...(min !== undefined && { min }),
      ...(s.maximum !== undefined && { max: s.maximum }),
      ...(typeof s.default === "number" && { default: s.default }),
    };
  }
  return { kind: "readonly" };
}

const cache = new WeakMap<object, FieldSpec[]>();

export function propFields(definition: Pick<ElementDefinition, "propsSchema">): FieldSpec[] {
  const cached = cache.get(definition.propsSchema);
  if (cached) return cached;
  const json = z.toJSONSchema(definition.propsSchema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  const entries = Object.entries(json.properties ?? {});
  // A point is a focus on the element's picture when it has one (the first asset prop), and
  // a fraction rectangle is its crop.
  const asset = entries.find(([, schema]) => fieldKind(schema).kind === "asset")?.[0];
  const fields = entries.map(([key, schema]): FieldSpec => {
    const kind: FieldKind = !asset
      ? fieldKind(schema)
      : flatten(schema).some(isPoint)
        ? { kind: "focus", asset }
        : flatten(schema).some(isFractionRect)
          ? { kind: "crop", asset }
          : fieldKind(schema);
    return { key, label: labelFor(key), ...kind };
  });
  cache.set(definition.propsSchema, fields);
  return fields;
}
