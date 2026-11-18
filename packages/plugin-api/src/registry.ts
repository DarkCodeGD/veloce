/**
 * The plugin registry: which element types exist, and whether an element's props are valid.
 *
 * Plug it into core with `registry.applyContext()`, so every op (from a human or an agent)
 * validates element props against the owning plugin's schema.
 */
import {
  type ApplyContext,
  type Deck,
  ELEMENT_TYPE_PATTERN,
  type ElementCheck,
  formatIssues,
  suggest,
  walkNodes,
} from "@veloce/core";
import { z } from "zod";
import type { ElementDefinition, PluginManifest, VelocePlugin } from "./types.js";

const PluginManifestSchema = z.strictObject({
  id: z
    .string()
    .max(100)
    .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/, {
      error: 'Plugin IDs are namespaced and lowercase, e.g. "acme.sparkles"',
    }),
  name: z.string().min(1).max(100),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, { error: 'Expected a semver like "1.2.0"' }),
  description: z.string().max(500).optional(),
  license: z.string().max(100).optional(),
  homepage: z.string().url().optional(),
});

/** Plugins under this namespace may register bare element type IDs (`text`, `shape`…). */
const CORE_NAMESPACE = "veloce.";

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

export interface RegisteredElement {
  definition: ElementDefinition;
  plugin: PluginManifest;
}

/** What an AI agent (or a picker UI) needs to know about an element type. */
export interface ElementTypeInfo {
  type: string;
  title: string;
  description: string;
  plugin: { id: string; version: string };
  deterministic: boolean;
  defaultProps: Record<string, unknown>;
  /** JSON Schema of the props, generated from the zod schema. */
  propsJsonSchema: Record<string, unknown>;
}

export class PluginRegistry {
  readonly #plugins = new Map<string, VelocePlugin>();
  readonly #elements = new Map<string, RegisteredElement>();

  register(plugin: VelocePlugin): this {
    const manifest = PluginManifestSchema.safeParse(plugin.manifest);
    if (!manifest.success) {
      throw new PluginError(
        `Invalid plugin manifest: ${formatIssues(manifest.error.issues, ["manifest"])}`,
      );
    }
    const { id } = plugin.manifest;
    if (this.#plugins.has(id)) throw new PluginError(`Plugin "${id}" is already registered`);

    const seen = new Set<string>();
    for (const element of plugin.elements) {
      const { type } = element;
      if (!ELEMENT_TYPE_PATTERN.test(type))
        throw new PluginError(`"${id}": invalid element type "${type}"`);
      if (!type.includes(".") && !id.startsWith(CORE_NAMESPACE)) {
        throw new PluginError(
          `"${id}": element type "${type}" must be namespaced (e.g. "${id.split(".")[0]}.${type}"); bare types are reserved for built-ins`,
        );
      }
      const owner = this.#elements.get(type);
      if (owner || seen.has(type)) {
        throw new PluginError(
          `Element type "${type}" is already provided by "${owner?.plugin.id ?? id}"`,
        );
      }
      const defaults = element.propsSchema.safeParse(element.defaultProps);
      if (!defaults.success) {
        throw new PluginError(
          `"${type}": defaultProps don't match propsSchema: ${formatIssues(defaults.error.issues)}`,
        );
      }
      seen.add(type);
    }

    this.#plugins.set(id, plugin);
    for (const definition of plugin.elements) {
      this.#elements.set(definition.type, { definition, plugin: plugin.manifest });
    }
    return this;
  }

  unregister(pluginId: string): boolean {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) return false;
    for (const element of plugin.elements) this.#elements.delete(element.type);
    return this.#plugins.delete(pluginId);
  }

  get(type: string): RegisteredElement | undefined {
    return this.#elements.get(type);
  }

  has(type: string): boolean {
    return this.#elements.has(type);
  }

  types(): string[] {
    return [...this.#elements.keys()].sort();
  }

  plugins(): PluginManifest[] {
    return [...this.#plugins.values()].map((p) => p.manifest);
  }

  /** Core's element validator. An arrow function, so it can be passed around unbound. */
  readonly validateElement = (type: string, props: Record<string, unknown>): ElementCheck => {
    const registered = this.#elements.get(type);
    if (!registered) {
      const close = suggest(type, this.#elements.keys());
      const hint = close.length
        ? `Did you mean ${close.map((t) => `"${t}"`).join(" or ")}?`
        : `Installed types: ${this.types().join(", ") || "none"}.`;
      return {
        ok: false,
        reason: "unknown-type",
        message: `Unknown element type "${type}". ${hint}`,
      };
    }
    const result = registered.definition.propsSchema.safeParse(props);
    if (result.success) return { ok: true };
    return {
      ok: false,
      reason: "invalid-props",
      message: formatIssues(result.error.issues, ["props"]),
    };
  };

  /** Hooks for `@veloce/core` (`applyTransaction`, `DeckDocument`, `validateDeck`). */
  applyContext(): ApplyContext {
    return { validateElement: this.validateElement };
  }

  describe(type: string): ElementTypeInfo | undefined {
    const registered = this.#elements.get(type);
    if (!registered) return undefined;
    const { definition: d, plugin } = registered;
    return {
      type: d.type,
      title: d.title,
      description: d.description,
      plugin: { id: plugin.id, version: plugin.version },
      deterministic: d.deterministic,
      defaultProps: d.defaultProps,
      propsJsonSchema: z.toJSONSchema(d.propsSchema) as Record<string, unknown>,
    };
  }

  describeAll(): ElementTypeInfo[] {
    return this.types().flatMap((type) => this.describe(type) ?? []);
  }

  /** plugins.lock.json content for a deck: the plugins (and versions) its elements use. */
  lockFor(deck: Deck): Record<string, string> {
    const lock: Record<string, string> = {};
    for (const slide of deck.slides) {
      for (const { node } of walkNodes(slide.root)) {
        if (node.kind !== "element") continue;
        const plugin = this.#elements.get(node.type)?.plugin;
        if (plugin) lock[plugin.id] = plugin.version;
      }
    }
    return lock;
  }
}
