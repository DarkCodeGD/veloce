import { createBuiltinRegistry } from "@veloce/builtins";
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
    expect(text.italic).toMatchObject({ kind: "boolean" });
    expect(fields("shape").fill).toMatchObject({ kind: "paint" });
    expect(fields("shape").radius).toMatchObject({ kind: "length", group: "radius" });
    expect(fields("image").alt).toMatchObject({ kind: "text" });
    expect(fields("image").asset).toMatchObject({ kind: "readonly" });
    expect(labelFor("lineHeight")).toBe("Line height");
  });
});
