/**
 * Which element types draw graphics (D127): shapes, lines and arrows, and paths. Lint,
 * choreography and morph treat them alike: decoration, diagrams and icons rather than
 * content to read. One list, so a new graphic type can't be missed in one of them.
 */
import type { Node } from "../schema/node.js";

export const GRAPHIC_TYPES: ReadonlySet<string> = new Set(["shape", "line", "vector"]);

/** A shape, a line or a vector. */
export const isGraphic = (node: Node): boolean =>
  node.kind === "element" && GRAPHIC_TYPES.has(node.type);
