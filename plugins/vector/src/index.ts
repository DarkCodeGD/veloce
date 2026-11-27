/**
 * Built-in vector plugin (D127): the `line` element (lines and arrows with two ends) and the
 * `vector` element (any shape from safe, strictly parsed path data).
 */
import { definePlugin } from "@veloce/plugin-api";
import { lineElement } from "./line.js";
import { vectorElement } from "./vector.js";

export * from "./line.js";
export * from "./vector.js";

export const vectorPlugin = definePlugin({
  manifest: {
    id: "veloce.vector",
    name: "Vector",
    version: "0.1.0",
    description: "Built-in line and vector elements: lines and arrows, and path drawings.",
    license: "Apache-2.0",
  },
  elements: [lineElement, vectorElement],
});
