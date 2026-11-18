import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/renderer (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/renderer");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/core", "@veloce/plugin-api"]);
  });
});
