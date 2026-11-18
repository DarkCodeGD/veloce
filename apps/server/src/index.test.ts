import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/server (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/server");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/doc-server", "@veloce/mcp"]);
  });
});
