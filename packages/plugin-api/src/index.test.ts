import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/plugin-api (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/plugin-api");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/core"]);
  });
});
