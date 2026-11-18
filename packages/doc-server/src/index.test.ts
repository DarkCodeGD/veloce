import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/doc-server (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/doc-server");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/core", "@veloce/format"]);
  });
});
