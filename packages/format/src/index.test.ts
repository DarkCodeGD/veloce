import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/format (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/format");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/core"]);
  });
});
