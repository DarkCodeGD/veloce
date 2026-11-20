import { createBuiltinRegistry } from "@veloce/builtins";
import { AssetRefSchema, PointSchema, StrokeSchema } from "@veloce/core";
import { z } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { labelFor, propFields } from "./schema-fields.js";

describe("inspector fields from plugin schemas", () => {
  const registry = createBuiltinRegistry();
  const fields = (type: string) => {
    const definition = registry.get(type)?.definition;
    if (!definition) throw new Error(type);
    return Object.fromEntries(propFields(definition).map(({ key, ...rest }) => [key, rest]));
  };

  it("maps every built-in prop to a control", () => {
    const text = fields("text");
    expect(text.content).toMatchObject({ kind: "richText", label: "Content" });
    expect(text.style).toMatchObject({ kind: "token", group: "text" });
    expect(text.color).toMatchObject({ kind: "color" });
    expect(text.align).toMatchObject({
      kind: "enum",
      options: ["left", "center", "right", "justify"],
    });
    expect(text.verticalAlign?.label).toBe("Vertical align");
    expect(text.fontWeight).toMatchObject({ kind: "number", integer: true, min: 100, max: 900 });
    // `.positive()` → the smallest allowed value sits just above zero, never zero itself.
    expect(text.fontSize).toMatchObject({ kind: "number", integer: false, min: 0.01, max: 2000 });
    expect(text.italic).toMatchObject({ kind: "boolean" });
    expect(fields("shape").fill).toMatchObject({ kind: "paint" });
    expect(fields("shape").radius).toMatchObject({ kind: "length", group: "radius" });
    expect(fields("shape").stroke).toMatchObject({ kind: "stroke" });
    expect(fields("image").alt).toMatchObject({ kind: "text" });
    expect(fields("image").asset).toMatchObject({ kind: "asset" });
    expect(fields("image").focus).toMatchObject({ kind: "focus", asset: "asset" });
    expect(labelFor("lineHeight")).toBe("Line height");
  });

  it("knows a stroke by its shape, not by its name", () => {
    const kind = (schema: z.ZodType) =>
      propFields({ propsSchema: z.strictObject({ line: schema }) })[0]?.kind;
    expect(kind(StrokeSchema)).toBe("stroke");
    expect(kind(StrokeSchema.optional())).toBe("stroke");
    // Other objects with a color and a width aren't strokes.
    expect(kind(z.strictObject({ color: z.string(), width: z.number() }))).toBe("readonly");
    expect(
      kind(
        z.strictObject({ color: StrokeSchema.shape.color, width: z.number(), glow: z.number() }),
      ),
    ).toBe("readonly");
  });

  it("knows a focus point by its shape: a point on an element that has a picture (D82)", () => {
    const kinds = (shape: Record<string, z.ZodType>) =>
      propFields({ propsSchema: z.strictObject(shape) }).map((f) => f.kind);
    expect(kinds({ photo: AssetRefSchema, aim: PointSchema.optional() })).toEqual([
      "asset",
      "focus",
    ]);
    const [, aim] = propFields({
      propsSchema: z.strictObject({ src: AssetRefSchema, aim: PointSchema }),
    });
    expect(aim).toMatchObject({ kind: "focus", asset: "src" });
    // No picture to aim at, or not exactly x and y: not a focus.
    expect(kinds({ aim: PointSchema })).toEqual(["readonly"]);
    expect(
      kinds({
        photo: AssetRefSchema,
        aim: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
      }),
    ).toEqual(["asset", "readonly"]);
  });
});
