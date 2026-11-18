/** App-wide singletons: one plugin registry and one server connection per tab. */
import { createBuiltinRegistry } from "@veloce/builtins";
import { SyncClient } from "./sync-client.js";

export const registry = createBuiltinRegistry();

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
export const client = new SyncClient(wsUrl);

export const assetUrl = (deckId: string, assetId: string) =>
  `/api/decks/${encodeURIComponent(deckId)}/assets/${assetId}`;

/** `"agent:claude-code"` → `"Claude Code"`. */
export function originLabel(origin: string): string {
  if (origin === "user") return "You";
  const id = origin.replace(/^agent:/, "");
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
