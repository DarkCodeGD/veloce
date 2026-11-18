import { describe, expect, it } from "vitest";
import { dependsOn, packageName } from "./index.js";

describe("@veloce/desktop (workspace wiring)", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@veloce/desktop");
  });

  it("resolves its workspace dependencies", () => {
    expect(dependsOn).toEqual(["@veloce/doc-server", "@veloce/mcp"]);
  });
});
