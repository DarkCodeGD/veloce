import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/mcp (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/mcp");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/core", "@veloce/doc-server"]);
  });
});
