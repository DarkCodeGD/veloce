/**
 * Built-in vector plugin (D127): the `line` element (lines and arrows with two ends) and,
 * next, the `vector` element (safe path drawings).
 */
import { definePlugin } from "@veloce/plugin-api";
import { lineElement } from "./line.js";

export * from "./line.js";

export const vectorPlugin = definePlugin({
  manifest: {
    id: "veloce.vector",
    name: "Vector",
    version: "0.1.0",
    description: "Built-in line element: lines and arrows with two ends.",
    license: "Apache-2.0",
  },
  elements: [lineElement],
});
