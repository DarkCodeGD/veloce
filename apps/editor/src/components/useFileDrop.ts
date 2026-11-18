/**
 * Files dragged from the desktop onto the canvas: show that a drop will land, then import them
 * at the drop point (see import-files.ts). Only drags that carry files count; dragging text
 * or a link over the canvas does nothing. The browser's default (opening the file in the tab,
 * which would leave the editor) is always prevented over the canvas.
 */
import type { Deck } from "@veloce/core";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { SlideIndex } from "../model/slide-index.js";
import { importFiles } from "./import-files.js";

const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

export function useFileDrop(
  target: RefObject<HTMLElement | null>,
  state: {
    deck: Deck;
    index: SlideIndex;
    selection: readonly string[];
    onSelect(ids: string[]): void;
  },
): boolean {
  const [over, setOver] = useState(false);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    // dragenter/dragleave fire for every child crossed: count them to know when we're out.
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // allows the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const { deck, index, selection, onSelect } = latest.current;
      void importFiles({
        deck,
        index,
        selection,
        files,
        dropAt: { x: e.clientX, y: e.clientY },
      }).then((ids) => ids?.length && onSelect(ids));
    };
    el.addEventListener("dragenter", onEnter);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onEnter);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [target]);

  return over;
}
