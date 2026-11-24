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
  withWorkspace,
  workspaceSpec,
} from "./workspace.js";

const LEFT: SizeSpec = { axis: "x", initial: 248, min: 180, max: 400, maxShare: 0.2 };

describe("workspaces (D90)", () => {
  it("starts on Design; Animate is the second workspace (D118)", () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual(["design", "animate"]);
    expect(DEFAULT_LAYOUT.workspace).toBe("design");
    expect(workspaceSpec("present").id).toBe("design"); // a newer version's workspace
  });

  it("switches workspace, each keeping its own panel sizes", () => {
    let state = withPanel(DEFAULT_LAYOUT, "inspector", { size: 400 });
    state = withWorkspace(state, "animate");
    expect(panelLayout(state, "inspector").size).toBe(320); // Animate's own preset
    state = withPanel(state, "inspector", { size: 360 });
    state = withWorkspace(state, "design");
    expect(panelLayout(state, "inspector").size).toBe(400);
    expect(withWorkspace(state, "present")).toBe(state); // not in this version
    expect(parseLayout(withWorkspace(state, "animate")).workspace).toBe("animate");
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
      workspace: "present", // not in this version
      panels: {
        design: {
          left: { size: 10, collapsed: true }, // clamped up to its minimum
          inspector: { size: "wide" }, // broken: back to the preset
          notes: { collapsed: true }, // sizes itself: only collapsed matters
          timeline: { size: 200 }, // not a Design panel
        },
        present: { left: { size: 300 } }, // nor this
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
