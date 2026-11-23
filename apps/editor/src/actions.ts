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

// ── Versions (D93) ──

/** File → Save version: true when it's saved (in the file, by then). */
export async function saveVersion(name: string): Promise<boolean> {
  try {
    await client.saveVersion(name);
    showToast({ message: `Saved version "${name.trim()}"`, tone: "info" });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

/** Turns the deck back into a version; the toast's Undo (like Ctrl+Z) brings it back. */
export async function restoreVersion(id: string, name: string): Promise<boolean> {
  try {
    await client.restoreVersion(id);
    showToast(
      { message: `Restored "${name}"`, tone: "info", action: { label: "Undo", run: undo } },
      8000,
    );
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

/** Deletes a version for good (it's not an edit: no undo). */
export async function deleteVersion(id: string): Promise<boolean> {
  try {
    await client.deleteVersion(id);
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}
