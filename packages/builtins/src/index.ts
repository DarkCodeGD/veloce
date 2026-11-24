/**
 * The plugins every Veloce install ships with. Apps (editor, server, desktop) build their
 * registry from this list so they always agree on which element types and effects exist.
 *
 * Importing this in Node is safe: plugins only touch the DOM inside `mount()`.
 */
import { PluginRegistry, type VelocePlugin } from "@veloce/plugin-api";
import { effectsPlugin } from "@veloce/plugin-effects";
import { imagePlugin } from "@veloce/plugin-image";
import { shapePlugin } from "@veloce/plugin-shape";
import { textPlugin } from "@veloce/plugin-text";

export const BUILTIN_PLUGINS: readonly VelocePlugin[] = [
  textPlugin,
  shapePlugin,
  imagePlugin,
  effectsPlugin,
];

/** A registry with the built-in plugins registered. */
export function createBuiltinRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  for (const plugin of BUILTIN_PLUGINS) registry.register(plugin);
  return registry;
}
