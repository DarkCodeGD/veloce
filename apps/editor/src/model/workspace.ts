/**
 * Workspaces (D53, D90): each one is a fixed preset of panels over the same deck. Its panels
 * resize and collapse, and the app remembers their sizes per workspace, plus the last
 * workspace used. Blender's idea with Figma's restraint: no splitting areas into any editor.
 *
 * Pure: no DOM, no storage. `layout.ts` keeps the state and persists it; the splitter and
 * App read it. Phase 4 adds Animate and Present here as more presets, and the workspace
 * switcher appears once there's more than one (D53 §3: no empty tabs).
 */

/** The panels a workspace can show around the canvas. */
export type PanelId = "left" | "inspector" | "notes";

export interface PanelSpec {
  id: PanelId;
  /** Its name in menus and on its splitter ("Resize inspector"). */
  label: string;
  /** How its edge resizes it; none when it sizes itself (notes grow with their text). */
  size?: SizeSpec;
}

/** A resizable panel's size, in pixels. */
export interface SizeSpec {
  /** Which way it resizes: "x" changes its width, "y" its height. */
  axis: "x" | "y";
  /** What it starts at, and the range a drag or a key keeps it in. */
  initial: number;
  min: number;
  max: number;
  /**
   * The most of the window it may take along its axis (0.2 = a fifth), so a small window
   * still leaves the canvas room. Applied in CSS and in the splitter alike.
   */
  maxShare: number;
}

export interface WorkspaceSpec {
  id: string;
  label: string;
  panels: readonly PanelSpec[];
}

/**
 * One panel's remembered state. A collapsed panel keeps its size for when it reopens; a
 * panel that sizes itself has size 0.
 */
export interface PanelLayout {
  size: number;
  collapsed: boolean;
}

export interface LayoutState {
  /** The workspace on screen (the last one used, on startup). */
  workspace: string;
  /** Per workspace, per panel: only what differs from the preset is stored. */
  panels: Readonly<Record<string, Readonly<Partial<Record<PanelId, PanelLayout>>>>>;
}

/** The workspaces that exist in this version, in switcher order. */
export const WORKSPACES: readonly WorkspaceSpec[] = [
  {
    id: "design",
    label: "Design",
    panels: [
      {
        id: "left",
        label: "Left panel",
        size: { axis: "x", initial: 248, min: 180, max: 400, maxShare: 0.2 },
      },
      {
        id: "inspector",
        label: "Inspector",
        size: { axis: "x", initial: 300, min: 260, max: 480, maxShare: 0.26 },
      },
      // Grows with its text; collapsed, its "Speaker notes" header stays to reopen it.
      { id: "notes", label: "Speaker notes" },
    ],
  },
];

export const DEFAULT_LAYOUT: LayoutState = { workspace: "design", panels: {} };

/** A workspace by id; an unknown id (a stored one from a newer version) gets the first. */
export function workspaceSpec(id: string): WorkspaceSpec {
  const first = WORKSPACES[0];
  if (!first) throw new Error("No workspaces defined");
  return WORKSPACES.find((w) => w.id === id) ?? first;
}

/** A panel of a workspace, if that workspace has it. */
export function panelSpec(workspace: string, panel: PanelId): PanelSpec | undefined {
  return workspaceSpec(workspace).panels.find((p) => p.id === panel);
}

/** A panel's state in a workspace: what's remembered, else the preset's. */
export function panelLayout(state: LayoutState, panel: PanelId): PanelLayout {
  const stored = state.panels[state.workspace]?.[panel];
  if (stored) return stored;
  return { size: panelSpec(state.workspace, panel)?.size?.initial ?? 0, collapsed: false };
}

/** Keeps a size within the panel's range (whole pixels); 0 for a panel that sizes itself. */
export function clampSize(spec: PanelSpec, size: number): number {
  if (!spec.size) return 0;
  return Math.round(Math.min(spec.size.max, Math.max(spec.size.min, size)));
}

/** The state with one panel of the current workspace changed. */
export function withPanel(
  state: LayoutState,
  panel: PanelId,
  patch: Partial<PanelLayout>,
): LayoutState {
  const spec = panelSpec(state.workspace, panel);
  if (!spec) return state;
  const before = panelLayout(state, panel);
  const next: PanelLayout = {
    size: patch.size === undefined ? before.size : clampSize(spec, patch.size),
    collapsed: patch.collapsed ?? before.collapsed,
  };
  if (next.size === before.size && next.collapsed === before.collapsed) return state;
  return {
    ...state,
    panels: {
      ...state.panels,
      [state.workspace]: { ...state.panels[state.workspace], [panel]: next },
    },
  };
}

/**
 * Where a drag of a panel's edge leaves it (VS Code's sash): past half its minimum it
 * collapses, keeping its last size for when it reopens; otherwise it takes the dragged
 * size within its range and `cap` (the most the window allows right now).
 */
export function draggedTo(spec: SizeSpec, size: number, cap = Number.POSITIVE_INFINITY) {
  if (size < spec.min / 2) return { collapsed: true } as const;
  const kept = Math.min(spec.max, Math.max(spec.min, size), cap);
  return { collapsed: false, size: Math.round(kept) } as const;
}

/** The most a panel may take of a window this size, in pixels. */
export const panelCap = (spec: SizeSpec, window: { width: number; height: number }) =>
  Math.min(spec.max, (spec.axis === "x" ? window.width : window.height) * spec.maxShare);

/**
 * Reads a stored layout, keeping only what's valid in this version: an unknown workspace,
 * panel or a broken value is dropped (falls back to the preset), sizes are clamped. A
 * layout can't break the app, whatever an older or newer version wrote.
 */
export function parseLayout(raw: unknown): LayoutState {
  if (!isRecord(raw)) return DEFAULT_LAYOUT;
  const workspace =
    typeof raw.workspace === "string" && WORKSPACES.some((w) => w.id === raw.workspace)
      ? raw.workspace
      : DEFAULT_LAYOUT.workspace;
  const panels: Record<string, Partial<Record<PanelId, PanelLayout>>> = {};
  const stored = isRecord(raw.panels) ? raw.panels : {};
  for (const ws of WORKSPACES) {
    const entries = stored[ws.id];
    if (!isRecord(entries)) continue;
    const kept: Partial<Record<PanelId, PanelLayout>> = {};
    for (const spec of ws.panels) {
      const entry = entries[spec.id];
      if (!isRecord(entry)) continue;
      const size =
        typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : Number.NaN;
      if (spec.size && Number.isNaN(size)) continue; // a resizable panel needs its size
      kept[spec.id] = { size: clampSize(spec, size), collapsed: entry.collapsed === true };
    }
    if (Object.keys(kept).length > 0) panels[ws.id] = kept;
  }
  return { workspace, panels };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
