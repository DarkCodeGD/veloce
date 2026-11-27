import { describe, expect, it } from "vitest";
import { createBuiltinRegistry } from "./index.js";

describe("builtins", () => {
  it("registers text, shape, line and image, with JSON Schemas for agents", () => {
    const registry = createBuiltinRegistry();
    expect(registry.types()).toEqual(["image", "line", "shape", "text"]);
    for (const info of registry.describeAll()) {
      expect(info.propsJsonSchema.type).toBe("object");
    }
  });
});
