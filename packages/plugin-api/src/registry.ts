/**
 * The plugin registry: which element types and effects exist, and whether an element's props
 * and an animation's effect are valid.
 *
 * Plug it into core with `registry.applyContext()`, so every op (from a human or an agent)
 * validates element props and effects against the owning plugin's schemas; hand
 * `registry.resolveEffect` to whatever plays slides (`SlidePlayer`, `compileSlide`).
 */
import {
  type ApplyContext,
  type Deck,
  type EffectCheck,
  type EffectRef,
  type EffectResolver,
  ELEMENT_TYPE_PATTERN,
  type ElementCheck,
  formatIssues,
  type Node,
  suggest,
  TracksSchema,
  walkNodes,
} from "@veloce/core";
import { z } from "zod";
import type {
  EffectDefinition,
  EffectKind,
  ElementDefinition,
  PluginManifest,
  VelocePlugin,
} from "./types.js";

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

export interface RegisteredEffect {
  definition: EffectDefinition;
  plugin: PluginManifest;
}

/** What an AI agent (or the preset gallery) needs to know about an effect. */
export interface EffectInfo {
  name: string;
  title: string;
  description: string;
  kind: EffectKind;
  /** Element types it plays on; absent: any layer. */
  targets?: readonly string[];
  plugin: { id: string; version: string };
  defaultParams: Record<string, unknown>;
  /** JSON Schema of the params, generated from the zod schema. */
  paramsJsonSchema: Record<string, unknown>;
  aiDocs: string;
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
  readonly #effects = new Map<string, RegisteredEffect>();

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

    const seenEffects = new Set<string>();
    for (const effect of plugin.effects ?? []) {
      const { name } = effect;
      if (!ELEMENT_TYPE_PATTERN.test(name))
        throw new PluginError(`"${id}": invalid effect name "${name}"`);
      if (!name.includes(".") && !id.startsWith(CORE_NAMESPACE)) {
        throw new PluginError(
          `"${id}": effect "${name}" must be namespaced (e.g. "${id.split(".")[0]}.${name}"); bare names are reserved for built-ins`,
        );
      }
      const owner = this.#effects.get(name);
      if (owner || seenEffects.has(name)) {
        throw new PluginError(
          `Effect "${name}" is already provided by "${owner?.plugin.id ?? id}"`,
        );
      }
      for (const [label, params] of [
        ["defaultParams", effect.defaultParams],
        ["no params", {}],
      ] as const) {
        const parsed = effect.paramsSchema.safeParse(params);
        if (!parsed.success) {
          throw new PluginError(
            `Effect "${name}": ${label} don't match paramsSchema (every param is optional, defaults fill in): ${formatIssues(parsed.error.issues)}`,
          );
        }
      }
      seenEffects.add(name);
    }

    this.#plugins.set(id, plugin);
    for (const definition of plugin.elements) {
      this.#elements.set(definition.type, { definition, plugin: plugin.manifest });
    }
    for (const definition of plugin.effects ?? []) {
      this.#effects.set(definition.name, { definition, plugin: plugin.manifest });
    }
    return this;
  }

  unregister(pluginId: string): boolean {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) return false;
    for (const element of plugin.elements) this.#elements.delete(element.type);
    for (const effect of plugin.effects ?? []) this.#effects.delete(effect.name);
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

  /** Effect names, sorted. */
  effectNames(): string[] {
    return [...this.#effects.keys()].sort();
  }

  getEffect(name: string): RegisteredEffect | undefined {
    return this.#effects.get(name);
  }

  /**
   * Core's effect validator (D117): the effect exists, suits the target, and its params pass
   * its schema. An arrow function, so it can be passed around unbound.
   */
  readonly validateEffect = (effect: EffectRef, target: Node): EffectCheck => {
    const registered = this.#effects.get(effect.name);
    if (!registered) {
      const close = suggest(effect.name, this.#effects.keys());
      return {
        ok: false,
        reason: "unknown-effect",
        message: `Unknown effect "${effect.name}"`,
        hint: close.length
          ? `Did you mean ${close.map((n) => `"${n}"`).join(" or ")}?`
          : `Installed effects: ${this.effectNames().join(", ") || "none"}.`,
      };
    }
    const { definition } = registered;
    const targets = definition.targets;
    if (targets && (target.kind !== "element" || !targets.includes(target.type))) {
      const what = target.kind === "element" ? `a ${target.type} element` : "a frame";
      const fits = this.effectNames().filter((n) => !this.#effects.get(n)?.definition.targets);
      return {
        ok: false,
        reason: "wrong-target",
        message: `"${effect.name}" plays on ${targets.map((t) => `${t} elements`).join(" or ")}, and "${target.id}" is ${what}`,
        hint: `Effects for any layer: ${fits.join(", ")}.`,
      };
    }
    const parsed = definition.paramsSchema.safeParse(effect.params ?? {});
    if (parsed.success) return { ok: true };
    return {
      ok: false,
      reason: "invalid-params",
      message: `"${effect.name}": ${formatIssues(parsed.error.issues, ["params"])}`,
      hint: `Its params, all optional: ${Object.keys(definition.defaultParams).join(", ") || "none"}. Defaults: ${JSON.stringify(definition.defaultParams)}.`,
    };
  };

  /**
   * Core's effect resolver: the effect's tracks for one animation, or null when the effect is
   * unknown, its params are invalid, or it throws or returns tracks that aren't valid. Then
   * the animation keeps its place in time without moving (D114 §8): a broken plugin never
   * breaks a slide.
   */
  readonly resolveEffect: EffectResolver = (effect, context) => {
    const definition = this.#effects.get(effect.name)?.definition;
    if (!definition) return null;
    const params = definition.paramsSchema.safeParse(effect.params ?? {});
    if (!params.success) return null;
    try {
      const resolved = definition.resolve(
        { ...definition.defaultParams, ...(params.data as object) },
        context,
      );
      return TracksSchema.safeParse(resolved.tracks).success ? resolved : null;
    } catch {
      return null;
    }
  };

  describeEffect(name: string): EffectInfo | undefined {
    const registered = this.#effects.get(name);
    if (!registered) return undefined;
    const { definition: d, plugin } = registered;
    return {
      name: d.name,
      title: d.title,
      description: d.description,
      kind: d.kind,
      ...(d.targets && { targets: d.targets }),
      plugin: { id: plugin.id, version: plugin.version },
      defaultParams: d.defaultParams,
      paramsJsonSchema: z.toJSONSchema(d.paramsSchema) as Record<string, unknown>,
      aiDocs: d.aiDocs,
    };
  }

  describeEffects(): EffectInfo[] {
    return this.effectNames().flatMap((name) => this.describeEffect(name) ?? []);
  }

  /** Hooks for `@veloce/core` (`applyTransaction`, `DeckDocument`, `validateDeck`). */
  applyContext(): ApplyContext {
    return { validateElement: this.validateElement, validateEffect: this.validateEffect };
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

  /** plugins.lock.json content for a deck: the plugins (and versions) its elements and effects use. */
  lockFor(deck: Deck): Record<string, string> {
    const lock: Record<string, string> = {};
    for (const slide of deck.slides) {
      for (const { node } of walkNodes(slide.root)) {
        if (node.kind !== "element") continue;
        const plugin = this.#elements.get(node.type)?.plugin;
        if (plugin) lock[plugin.id] = plugin.version;
      }
      for (const animation of slide.animations ?? []) {
        const plugin = animation.effect && this.#effects.get(animation.effect.name)?.plugin;
        if (plugin) lock[plugin.id] = plugin.version;
      }
    }
    return lock;
  }
}
