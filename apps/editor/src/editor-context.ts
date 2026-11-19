/** App-wide singletons: one plugin registry and one server connection per tab. */
import { createBuiltinRegistry } from "@veloce/builtins";
import type { Node } from "@veloce/core";
import type { ResolvedSizing } from "./model/manipulate.js";
import { SyncClient } from "./sync-client.js";

export const registry = createBuiltinRegistry();

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
export const client = new SyncClient(wsUrl);

export const assetUrl = (deckId: string, assetId: string) =>
  `/api/decks/${encodeURIComponent(deckId)}/assets/${assetId}`;

/** A node's width/height as the renderer resolves them: its own, else its plugin's default. */
export function resolvedSizing(node: Node): { width: ResolvedSizing; height: ResolvedSizing } {
  const defaults =
    node.kind === "element" ? registry.get(node.type)?.definition.defaultSize : undefined;
  return {
    width: node.width ?? defaults?.width ?? "auto",
    height: node.height ?? defaults?.height ?? "auto",
  };
}
