/** Sending editor commands to the server, with feedback when the server says no. */
import { client } from "./editor-context.js";
import type { Command } from "./model/commands.js";
import { revertMessage } from "./model/history.js";
import { SyncError } from "./sync-client.js";
import { showToast } from "./toasts.js";

export function reportError(error: unknown): void {
  const message = error instanceof SyncError ? error.message : "Something went wrong";
  if (!(error instanceof SyncError)) console.error(error);
  showToast({ message, tone: "error" });
}

/**
 * Send a command as one undoable transaction. Resolves true when the server applied it.
 * `undoToast` shows a toast with Undo afterwards: the command's label, or the given words.
 */
export async function run(
  command: Command | null,
  { undoToast = false }: { undoToast?: boolean | string } = {},
): Promise<boolean> {
  if (!command) return false;
  try {
    await client.transact(command.label, command.ops);
    if (undoToast) {
      const message = typeof undoToast === "string" ? undoToast : command.label;
      showToast({ message, tone: "info", action: { label: "Undo", run: undo } });
    }
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

export function undo(): void {
  client.undo().catch(reportError);
}

export function redo(): void {
  client.redo().catch(reportError);
}

/**
 * Revert agents' changes (D71) as one change of your own: the toast says what went (and any
 * of your later edits it touched), and its Undo, like Ctrl+Z, brings it all back.
 */
export async function revertAgentChanges(versions: number[]): Promise<void> {
  const before = client.getState();
  try {
    await client.revert(versions);
  } catch (error) {
    reportError(error);
    return;
  }
  // Numbered as they were before: the revert may have removed the slides it names.
  const numbers = new Map((before.deck?.slides ?? []).map((s, i) => [s.id, i + 1]));
  const after = new Set((client.getState().deck?.slides ?? []).map((s) => s.id));
  const message = revertMessage(
    before.history,
    versions,
    (id) => numbers.get(id),
    (id) => after.has(id),
  );
  showToast({ message, tone: "info", action: { label: "Undo", run: undo } }, 8000);
}

/** Make a new deck and switch to it (File → New deck). True when it was made. */
export async function createDeck(title: string, theme?: string): Promise<boolean> {
  try {
    await client.createDeck(title, theme);
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}
