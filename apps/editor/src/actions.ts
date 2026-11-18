/** Sending editor commands to the server, with feedback when the server says no. */
import { client } from "./editor-context.js";
import type { Command } from "./model/commands.js";
import { SyncError } from "./sync-client.js";
import { showToast } from "./toasts.js";

export function reportError(error: unknown): void {
  const message = error instanceof SyncError ? error.message : "Something went wrong";
  if (!(error instanceof SyncError)) console.error(error);
  showToast({ message, tone: "error" });
}

/** Send a command as one undoable transaction. Resolves true when the server applied it. */
export async function run(
  command: Command | null,
  { undoToast = false }: { undoToast?: boolean } = {},
): Promise<boolean> {
  if (!command) return false;
  try {
    await client.transact(command.label, command.ops);
    if (undoToast) {
      showToast({ message: command.label, tone: "info", action: { label: "Undo", run: undo } });
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
