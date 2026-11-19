/**
 * Architecture guard: enforces the package dependency graph from docs/ROADMAP.md.
 *
 * If this fails, you either added a forbidden dependency (fix the code), or the
 * architecture changed on purpose (update ALLOWED here AND record why in docs/DECISIONS.md).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Which internal (@veloce/*) packages each workspace project may depend on. */
const ALLOWED: Record<string, readonly string[]> = {
  "@veloce/core": [], // the foundation: zero internal deps, ever
  "@veloce/format": ["@veloce/core"],
  // Image optimization on import (D67): Node-only codecs, no Veloce dependencies.
  "@veloce/images": [],
  "@veloce/plugin-api": ["@veloce/core"],
  // The built-in plugin set; apps use it instead of each listing the plugins.
  "@veloce/builtins": [
    "@veloce/plugin-api",
    "@veloce/plugin-text",
    "@veloce/plugin-shape",
    "@veloce/plugin-image",
  ],
  "@veloce/renderer": ["@veloce/core", "@veloce/plugin-api"],
  "@veloce/doc-server": ["@veloce/core", "@veloce/format", "@veloce/images"],
  "@veloce/mcp": ["@veloce/core", "@veloce/doc-server", "@veloce/plugin-api"],
  "@veloce/server": ["@veloce/doc-server", "@veloce/mcp", "@veloce/core", "@veloce/builtins"],
  "@veloce/editor": [
    "@veloce/core",
    "@veloce/plugin-api",
    "@veloce/renderer",
    "@veloce/format",
    "@veloce/builtins",
  ],
  "@veloce/desktop": ["@veloce/doc-server", "@veloce/mcp", "@veloce/core", "@veloce/builtins"],
};

/** Plugins may only build on the public plugin API (and core types). */
const PLUGIN_ALLOWED = ["@veloce/core", "@veloce/plugin-api"];

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function workspacePackages(): { group: string; pkg: PackageJson }[] {
  const out: { group: string; pkg: PackageJson }[] = [];
  for (const group of ["apps", "packages", "plugins"]) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      const file = join(groupDir, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(file)) {
        out.push({ group, pkg: JSON.parse(readFileSync(file, "utf8")) as PackageJson });
      }
    }
  }
  return out;
}

function internalDeps(pkg: PackageJson): string[] {
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return Object.keys(all).filter((d) => d.startsWith("@veloce/"));
}

describe("architecture: dependency directions", () => {
  const packages = workspacePackages();

  it("finds the workspace projects", () => {
    expect(packages.length).toBeGreaterThanOrEqual(Object.keys(ALLOWED).length);
  });

  for (const { group, pkg } of packages) {
    it(`${pkg.name} only depends on allowed packages`, () => {
      const allowed = group === "plugins" ? PLUGIN_ALLOWED : ALLOWED[pkg.name];
      expect(allowed, `${pkg.name} is not registered in ALLOWED`).toBeDefined();
      const forbidden = internalDeps(pkg).filter((d) => !allowed?.includes(d));
      expect(forbidden, `${pkg.name} has forbidden deps`).toEqual([]);
    });
  }
});
