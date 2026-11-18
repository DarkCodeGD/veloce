import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@veloce/doc-server (placeholder)", () => {
  it("builds and exports its name", () => {
    expect(packageName).toBe("@veloce/doc-server");
  });
});
