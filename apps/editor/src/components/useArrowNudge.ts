/**
 * Arrow keys move the selected free layers (in absolute frames) by 1 px, Shift by 10 (or the
 * distances set in Preferences, D91): the
 * keyboard alternative to dragging them (WCAG 2.5.7). Like a drag, held keys preview
 * locally and releasing the last one commits one transaction (one undo step), however many
 * times the key repeated. Layers in stacks reorder with Alt+↑/↓ instead (App).
 */
import { useEffect } from "react";
import { run } from "../actions.js";
import { typing } from "../keyboard.js";
import { type Point, rotateVector } from "../model/geometry.js";
import { ancestorRotation, isFree, movedPosition, moveTo } from "../model/manipulate.js";
import { type SlideIndex, topmost } from "../model/slide-index.js";
import { setPreview } from "../preview.js";
import { settings } from "../settings.js";

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useArrowNudge(index: SlideIndex | null, selection: readonly string[]) {
  useEffect(() => {
    if (!index) return;
    const layers = topmost(index, selection).filter((id) => isFree(index, id));
    if (layers.length === 0) return;
    const held = new Set<string>();
    let offset: Point | null = null;

    const command = () => {
      const d = offset ?? { x: 0, y: 0 };
      const positions = new Map(
        layers.map((id) => {
          const node = index.nodes.get(id)?.node;
          // Screen directions, also inside rotated frames, in the layer's own anchor.
          const local = rotateVector(d, -ancestorRotation(index, id));
          return [id, node ? movedPosition(node, local) : local] as const;
        }),
      );
      return moveTo(index, positions);
    };
    const commit = () => {
      if (!offset) return;
      const c = command();
      offset = null;
      held.clear();
      if (c) void run(c).finally(() => setPreview(null));
      else setPreview(null);
    };

    const onDown = (e: KeyboardEvent) => {
      const v = ARROWS[e.key];
      if (!v || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target))
        return;
      e.preventDefault();
      const { nudge, nudgeBig } = settings().editing; // Preferences (D91)
      const step = e.shiftKey ? nudgeBig : nudge;
      offset = { x: (offset?.x ?? 0) + v.x * step, y: (offset?.y ?? 0) + v.y * step };
      held.add(e.key);
      setPreview(command()?.ops ?? null);
    };
    const onUp = (e: KeyboardEvent) => {
      if (held.delete(e.key) && held.size === 0) commit();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", commit);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", commit);
      commit(); // the selection or document changed mid-nudge: keep what was done
    };
  }, [index, selection]);
}
