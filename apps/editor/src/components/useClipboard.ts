/**
 * Ctrl/Cmd+C, X and V for layers, through the real clipboard events (not key handlers), so
 * the system clipboard carries them between slides, decks and editor tabs, and the browser's
 * own Edit menu works too. Text fields and the on-slide text editor keep their own clipboard:
 * events that start there are left alone. The op builders live in model/clipboard.ts.
 *
 * Images travel between decks: the payload lists the files the layers use, and pasting into
 * another deck copies them over before the (single) paste transaction. Image and font files
 * on the clipboard (a screenshot, a file copied in the file manager) are imported.
 */
import type { Deck } from "@veloce/core";
import { useEffect, useRef } from "react";
import { run } from "../actions.js";
import { copyAssets, UploadError } from "../assets.js";
import { deckKeysPassThrough, typing } from "../keyboard.js";
import {
  CLIPBOARD_MIME,
  type ClipboardPayload,
  copyNodes,
  cutNodes,
  missingAssets,
  parsePayload,
  pasteNodes,
  pasteText,
  plainTextOf,
  serializePayload,
} from "../model/clipboard.js";
import type { SlideIndex } from "../model/slide-index.js";
import { showToast } from "../toasts.js";
import { importFiles } from "./import-files.js";

/** Copy and paste belong to a text field there, not to the deck (a dropdown trigger has no text). */
const textField = (target: EventTarget | null) => typing(target) && !deckKeysPassThrough(target);

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
      const { deck, index, selection, setSelection } = latest.current;
      if (textField(e.target) || pageText() || !index || !e.clipboardData) return;
      const payload = copyNodes(
        index,
        selection,
        deck ? { deckId: deck.id, assets: deck.assets } : undefined,
      );
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
      if (textField(e.target) || !deck || !index || !e.clipboardData) return;
      const payload = parsePayload(e.clipboardData.getData(CLIPBOARD_MIME));
      e.preventDefault();
      if (payload) return void pasteLayers(payload);
      const files = [...e.clipboardData.files];
      if (files.length > 0) {
        void importFiles({ deck, index, selection, files }).then(
          (ids) => ids?.length && setSelection(ids),
        );
        return;
      }
      const command = pasteText(index, selection, e.clipboardData.getData("text/plain"));
      if (command) void run(command).then((ok) => ok && setSelection(command.select ?? []));
    };

    /** Layers from the clipboard; files from another deck are copied over first. */
    const pasteLayers = async (payload: ClipboardPayload) => {
      const { deck, index, setSelection } = latest.current;
      if (!deck || !index) return;
      const known = new Set(Object.keys(deck.assets));
      const { copyable, fromDeck } = missingAssets(payload, known);
      let copied: Awaited<ReturnType<typeof copyAssets>> = [];
      if (copyable.length > 0 && fromDeck && fromDeck !== deck.id) {
        const names = Object.fromEntries(
          copyable.map((id) => [id, payload.source?.assets[id]?.name]),
        );
        try {
          copied = await copyAssets(fromDeck, deck.id, copyable, names);
        } catch (error) {
          const message = error instanceof UploadError ? error.message : "Couldn't copy the images";
          return showToast({ message, tone: "error" });
        }
      }
      // The deck may have changed while the files were copied: paste into what's there now.
      const now = latest.current;
      if (!now.index || !now.deck || now.deck.id !== deck.id) return;
      const result = pasteNodes(
        now.index,
        payload,
        now.selection,
        new Set(Object.keys(now.deck.assets)),
        copied,
      );
      if (!result.ok) return showToast({ message: result.message, tone: "error" });
      if (await run(result.command)) setSelection(result.command.select ?? []);
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
