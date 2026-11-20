/**
 * The canvas tool (D81): Select, Hand, or one that draws a new layer. A drawing tool lasts
 * for one layer, then it's back to Select (Figma); Esc goes back too.
 */
import { createStore } from "./store.js";

/** Drawing tools are named after what they add (insertable IDs, model/insert.ts). */
export type DrawTool = "frame" | "rect" | "ellipse" | "text";
export type Tool = "select" | "hand" | DrawTool;

export const toolStore = createStore<Tool>("select");
export const setTool = (tool: Tool) => toolStore.set(tool);
export const useTool = toolStore.use;

export const isDrawTool = (tool: Tool): tool is DrawTool => tool !== "select" && tool !== "hand";
