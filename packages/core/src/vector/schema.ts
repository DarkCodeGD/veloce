/**
 * Zod schemas for vector props (D127): path data checked by the strict parser, and a
 * `viewBox`. Plugins build their props from these, so files, ops, MCP and the editor all
 * reject the same bad paths with the same message (golden rule 5).
 */
import { z } from "zod";
import { MAX_PATH_LENGTH, parsePathData } from "./path-data.js";

/** SVG path data (`"M 0 0 L 10 10 Z"`), parsed strictly; the error says where it broke. */
export const PathDataSchema = z
  .string()
  .max(MAX_PATH_LENGTH)
  .superRefine((d, ctx) => {
    const parsed = parsePathData(d);
    if (parsed.ok) return;
    const near = d.slice(Math.max(0, parsed.at - 12), parsed.at + 12);
    ctx.addIssue({
      code: "custom",
      message: `${parsed.message} (at character ${parsed.at}, near "${near}")`,
    });
  })
  .describe(
    'SVG path data: M/L/H/V/C/S/Q/T/A/Z, absolute or relative, e.g. "M 12 2 L 22 22 L 2 22 Z".',
  );

/** The path's own coordinate box: `{ x, y, width, height }`, like SVG's viewBox. */
export const ViewBoxSchema = z
  .strictObject({
    x: z.number().min(-1e6).max(1e6),
    y: z.number().min(-1e6).max(1e6),
    width: z.number().positive().max(1e6),
    height: z.number().positive().max(1e6),
  })
  .describe(
    'The coordinates the path is drawn in, e.g. { "x": 0, "y": 0, "width": 24, "height": 24 } for a 24-unit icon. Default: the path\'s own bounds.',
  );
export type ViewBox = z.infer<typeof ViewBoxSchema>;
