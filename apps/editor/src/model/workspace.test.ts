import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  draggedTo,
  type LayoutState,
  panelCap,
  panelLayout,
  panelSpec,
  parseLayout,
  type SizeSpec,
  WORKSPACES,
  withPanel,
  workspaceSpec,
} from "./workspace.js";

const LEFT: SizeSpec = { axis: "x", initial: 248, min: 180, max: 400, maxShare: 0.2 };

describe("workspaces (D90)", () => {
  it("starts on Design, today's editor, as the only workspace until Phase 4", () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual(["design"]);
    expect(DEFAULT_LAYOUT.workspace).toBe("design");
    expect(workspaceSpec("animate").id).toBe("design"); // a newer version's workspace
  });

  it("gives every panel its preset until it's changed", () => {
    expect(panelLayout(DEFAULT_LAYOUT, "left")).toEqual({ size: 248, collapsed: false });
    expect(panelLayout(DEFAULT_LAYOUT, "inspector")).toEqual({ size: 300, collapsed: false });
    // Notes grow with their text: no size of their own.
    expect(panelLayout(DEFAULT_LAYOUT, "notes")).toEqual({ size: 0, collapsed: false });
  });

  it("changes one panel, clamped to its range, keeping its size while collapsed", () => {
    let state: LayoutState = withPanel(DEFAULT_LAYOUT, "left", { size: 999 });
    expect(panelLayout(state, "left").size).toBe(400);
    state = withPanel(state, "left", { collapsed: true });
    expect(panelLayout(state, "left")).toEqual({ size: 400, collapsed: true });
    expect(panelLayout(state, "inspector")).toEqual({ size: 300, collapsed: false });
    // No change, same object (nothing to save or re-render).
    expect(withPanel(state, "left", { collapsed: true })).toBe(state);
    expect(withPanel(state, "notes", { size: 120 })).toBe(state);
  });

  it("collapses a dragged panel past half its minimum, and stops at the window's cap", () => {
    expect(draggedTo(LEFT, 89)).toEqual({ collapsed: true });
    expect(draggedTo(LEFT, 91)).toEqual({ collapsed: false, size: 180 });
    expect(draggedTo(LEFT, 300.4)).toEqual({ collapsed: false, size: 300 });
    expect(draggedTo(LEFT, 380, 288)).toEqual({ collapsed: false, size: 288 });
    expect(panelCap(LEFT, { width: 1440, height: 900 })).toBe(288);
    expect(panelCap(LEFT, { width: 3840, height: 2160 })).toBe(400);
  });

  it("reads back only what's valid, whatever a stored layout holds", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("left=300")).toEqual(DEFAULT_LAYOUT);
    const parsed = parseLayout({
      workspace: "animate", // not in this version
      panels: {
        design: {
          left: { size: 10, collapsed: true }, // clamped up to its minimum
          inspector: { size: "wide" }, // broken: back to the preset
          notes: { collapsed: true }, // sizes itself: only collapsed matters
          timeline: { size: 200 }, // not a Design panel
        },
        animate: { left: { size: 300 } },
      },
    });
    expect(parsed).toEqual({
      workspace: "design",
      panels: {
        design: { left: { size: 180, collapsed: true }, notes: { size: 0, collapsed: true } },
      },
    });
    expect(panelLayout(parsed, "inspector").size).toBe(
      panelSpec("design", "inspector")?.size?.initial,
    );
    // What the store writes reads back the same.
    expect(parseLayout(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});
