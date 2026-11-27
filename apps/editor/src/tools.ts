/**
 * The canvas tool (D81): Select, Hand, or one that draws a new layer. A drawing tool lasts
 * for one layer, then it's back to Select (Figma); Esc goes back too.
 */
import { createStore } from "./store.js";

/** Drawing tools are named after what they add (insertable IDs, model/insert.ts). */
/** The shapes past rect and ellipse (D127): drawn like them, chosen from the Shapes menu. */
export const OUTLINE_SHAPES = ["triangle", "polygon", "star", "arrow", "chevron"] as const;
export type DrawTool =
  | "frame"
  | "rect"
  | "ellipse"
  | (typeof OUTLINE_SHAPES)[number]
  | "line"
  | "arrow-line"
  | "text";
export type Tool = "select" | "hand" | DrawTool;

export const toolStore = createStore<Tool>("select");
export const setTool = (tool: Tool) => toolStore.set(tool);
export const useTool = toolStore.use;

export const isDrawTool = (tool: Tool): tool is DrawTool => tool !== "select" && tool !== "hand";
