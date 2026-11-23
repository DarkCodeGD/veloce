/**
 * The edge between a panel and the canvas (D90), the WAI-ARIA window splitter: drag it to
 * resize the panel, past half its minimum to collapse it (VS Code's sash), out again to
 * reopen it; double-click for the preset size. Focused, the arrows resize, Home/End go to
 * the smallest/largest and Enter collapses or reopens.
 *
 * While dragging, the size is written straight onto the panel (its `--panel-size` and
 * `data-collapsed`) and only saved to the layout on release: re-rendering the whole editor
 * on every pointer move would be wasted work, and the canvas follows the panel anyway.
 */
import { type RefObject, useRef } from "react";
import { draggedTo, type PanelLayout, panelCap, type SizeSpec } from "../model/workspace.js";

/** Pixels per arrow key press (Shift: four times that). */
const KEY_STEP = 16;

interface Props {
  /** The panel's name ("Inspector"), for the splitter's own. */
  label: string;
  spec: SizeSpec;
  layout: PanelLayout;
  /** +1 when moving along the axis grows the panel (a left panel), -1 when it shrinks it. */
  grow: 1 | -1;
  /** The panel element, sized by its `--panel-size`. */
  panel: RefObject<HTMLElement | null>;
  panelId: string;
  onChange(patch: Partial<PanelLayout>): void;
}

const windowCap = (spec: SizeSpec) =>
  panelCap(spec, { width: window.innerWidth, height: window.innerHeight });

/** Shows a size on the panel without a render (during a drag). */
function preview(panel: HTMLElement | null, next: Partial<PanelLayout>) {
  if (!panel) return;
  if (next.size !== undefined) panel.style.setProperty("--panel-size", `${next.size}px`);
  if (next.collapsed !== undefined) panel.toggleAttribute("data-collapsed", next.collapsed);
}

export function Splitter({ label, spec, layout, grow, panel, panelId, onChange }: Props) {
  /** The drag in progress: where it started, the window's cap then, the latest result. */
  const drag = useRef<{
    from: number;
    size: number;
    cap: number;
    last: Partial<PanelLayout>;
  } | null>(null);
  const along = (e: { clientX: number; clientY: number }) =>
    spec.axis === "x" ? e.clientX : e.clientY;
  // Read when used, not kept: the window may have been resized since the last render.
  const cap = windowCap(spec);
  const shown = Math.min(layout.size, cap);

  const end = () => {
    const done = drag.current;
    if (!done) return;
    drag.current = null;
    delete document.documentElement.dataset.resizing;
    // Leave the panel showing what's saved: a drag that ends collapsed keeps its old size,
    // and React won't rewrite a size it thinks is unchanged.
    preview(panel.current, { size: layout.size, ...done.last });
    onChange(done.last);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const [less, more] = spec.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const step = (e.shiftKey ? 4 : 1) * KEY_STEP;
    const cap = windowCap(spec);
    const shown = Math.min(layout.size, cap);
    let next: Partial<PanelLayout> | null = null;
    if (e.key === less || e.key === more) {
      const along = (e.key === more ? 1 : -1) * grow;
      const from = layout.collapsed ? spec.min : shown;
      next = { collapsed: false, size: Math.min(from + along * step, cap) };
    } else if (e.key === "Home") next = { collapsed: false, size: spec.min };
    else if (e.key === "End") next = { collapsed: false, size: cap };
    else if (e.key === "Enter") next = { collapsed: !layout.collapsed };
    if (!next) return;
    // The arrows are the splitter's here, never the editor's (next slide, nudge).
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter has no HTML element (<hr> can't take focus or values)
    <div
      role="separator"
      tabIndex={0}
      className={`splitter is-${spec.axis}`}
      aria-label={`Resize ${label.toLowerCase()}`}
      aria-orientation={spec.axis === "x" ? "vertical" : "horizontal"}
      aria-controls={panelId}
      aria-valuemin={0}
      aria-valuemax={Math.round(cap)}
      aria-valuenow={layout.collapsed ? 0 : Math.round(shown)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection, no focus theft from the canvas
        e.currentTarget.setPointerCapture(e.pointerId);
        const cap = windowCap(spec);
        drag.current = {
          from: along(e),
          size: layout.collapsed ? 0 : Math.min(layout.size, cap),
          cap,
          last: { size: layout.size, collapsed: layout.collapsed },
        };
        document.documentElement.dataset.resizing = spec.axis;
      }}
      onPointerMove={(e) => {
        const now = drag.current;
        if (!now) return;
        const next = draggedTo(spec, now.size + (along(e) - now.from) * grow, now.cap);
        now.last = next;
        preview(panel.current, next);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange({ collapsed: false, size: spec.initial })}
      onKeyDown={onKeyDown}
    />
  );
}
