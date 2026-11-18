import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@veloce/editor (placeholder)", () => {
  it("builds and exports its name", () => {
    expect(packageName).toBe("@veloce/editor");
  });
});
