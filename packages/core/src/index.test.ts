import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/core (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/core");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual([]);
  });
});
