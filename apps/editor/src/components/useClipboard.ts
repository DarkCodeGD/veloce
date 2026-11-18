/**
 * Ctrl/Cmd+C, X and V for layers, through the real clipboard events (not key handlers), so
 * the system clipboard carries them between slides, decks and editor tabs, and the browser's
 * own Edit menu works too. Text fields and the on-slide text editor keep their own clipboard:
 * events that start there are left alone. The op builders live in model/clipboard.ts.
 */
import type { Deck } from "@veloce/core";
import { useEffect, useRef } from "react";
import { run } from "../actions.js";
import { typing } from "../keyboard.js";
import {
  CLIPBOARD_MIME,
  copyNodes,
  cutNodes,
  parsePayload,
  pasteNodes,
  pasteText,
  plainTextOf,
  serializePayload,
} from "../model/clipboard.js";
import type { SlideIndex } from "../model/slide-index.js";
import { showToast } from "../toasts.js";

export function useClipboard(
  deck: Deck | null,
  index: SlideIndex | null,
  selection: readonly string[],
  setSelection: (ids: string[]) => void,
) {
  // Listeners stay put; they read the latest state from here.
  const latest = useRef({ deck, index, selection, setSelection });
  latest.current = { deck, index, selection, setSelection };

  useEffect(() => {
    /** Someone selected text on the page (a label, a toast): that's what they're copying. */
    const pageText = () => (window.getSelection()?.toString() ?? "") !== "";

    const onCopy = (e: ClipboardEvent) => {
      const { index, selection, setSelection } = latest.current;
      if (typing(e.target) || pageText() || !index || !e.clipboardData) return;
      const payload = copyNodes(index, selection);
      if (!payload) return;
      e.preventDefault();
      e.clipboardData.setData(CLIPBOARD_MIME, serializePayload(payload));
      e.clipboardData.setData("text/plain", plainTextOf(payload.nodes));
      if (e.type === "cut") {
        void run(cutNodes(index, selection), { undoToast: true }).then(
          (ok) => ok && setSelection([]),
        );
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const { deck, index, selection, setSelection } = latest.current;
      if (typing(e.target) || !deck || !index || !e.clipboardData) return;
      const payload = parsePayload(e.clipboardData.getData(CLIPBOARD_MIME));
      e.preventDefault();
      if (payload) {
        const result = pasteNodes(index, payload, selection, new Set(Object.keys(deck.assets)));
        if (!result.ok) return showToast({ message: result.message, tone: "error" });
        void run(result.command).then((ok) => ok && setSelection(result.command.select ?? []));
        return;
      }
      const command = pasteText(index, selection, e.clipboardData.getData("text/plain"));
      if (command) void run(command).then((ok) => ok && setSelection(command.select ?? []));
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}
