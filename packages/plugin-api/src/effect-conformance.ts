/**
 * Effect conformance kit (D117): checks that an effect preset honours the contract, at every
 * motion level. Like the element kit, it returns a report instead of using a test runner:
 * `expect(report.failures).toEqual([])`. Needs no DOM: effects are pure.
 *
 * What it checks:
 * - metadata, and that `defaultParams` and no params at all pass `paramsSchema`;
 * - at every level, with the default params and any given: `resolve` returns valid tracks,
 *   a valid duration and easing, the same output twice (deterministic), and tracks its
 *   target accepts (golden rule 5);
 * - entrances land where the layer rests (no motion keyframe at the end), and emphasis
 *   starts and ends there (none at either end), so effects compose with each other and
 *   with the layout.
 */
import {
  type Animation,
  type ApplyContext,
  animationProblem,
  createSlide,
  EasingSchema,
  ELEMENT_TYPE_PATTERN,
  element,
  formatIssues,
  MOTION_CHANNELS,
  MOTION_LEVELS,
  motionTokens,
  type Node,
  TracksSchema,
  timeSchema,
} from "@veloce/core";
import type { ConformanceReport } from "./conformance.js";
import type { EffectDefinition, EffectParams } from "./types.js";

export interface EffectConformanceOptions<P extends EffectParams> {
  /** The layer to play on. Default: a shape element (an effect with `targets` must give one). */
  target?: Node;
  /** More params to resolve with, besides the defaults. */
  params?: P[];
  /** Checks `props.*` tracks against the target's schema (usually `registry.applyContext()`). */
  context?: ApplyContext;
}

const CHANNELS: ReadonlySet<string> = new Set(MOTION_CHANNELS);

export function checkEffectConformance<P extends EffectParams>(
  definition: EffectDefinition<P>,
  options: EffectConformanceOptions<P> = {},
): ConformanceReport {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);
  const report = (): ConformanceReport => ({
    type: definition.name,
    passed: failures.length === 0,
    failures,
  });

  if (!ELEMENT_TYPE_PATTERN.test(definition.name)) fail(`invalid name "${definition.name}"`);
  for (const key of ["title", "description", "aiDocs"] as const) {
    if (!definition[key]?.trim()) fail(`${key} is empty`);
  }
  if (!["entrance", "exit", "emphasis"].includes(definition.kind)) {
    fail(`kind must be entrance, exit or emphasis, not "${definition.kind}"`);
  }
  for (const [label, params] of [
    ["defaultParams", definition.defaultParams],
    ["no params", {}],
  ] as const) {
    const parsed = definition.paramsSchema.safeParse(params);
    if (!parsed.success)
      fail(`${label} don't pass paramsSchema: ${formatIssues(parsed.error.issues)}`);
  }

  if (definition.targets && !options.target) {
    fail("an effect with `targets` needs options.target to be checked on");
    return report();
  }
  const target = options.target ?? element("shape", { shape: "rect" }, { id: "target" });
  if (
    definition.targets &&
    !(target.kind === "element" && definition.targets.includes(target.type))
  ) {
    fail(`options.target isn't one of its targets (${definition.targets.join(", ")})`);
    return report();
  }
  const slide = createSlide({ id: "slide", children: [target] });

  for (const params of [definition.defaultParams, ...(options.params ?? [])]) {
    const full = { ...definition.defaultParams, ...params } as P;
    const label = JSON.stringify(params);
    for (const level of MOTION_LEVELS) {
      const at = `at ${level} with ${label}`;
      const animation = {
        id: "animation",
        target: target.id,
        effect: { name: definition.name, params },
      } as Animation;
      const context = { animation, target, tokens: motionTokens(undefined, level) };
      let resolved: ReturnType<typeof definition.resolve>;
      try {
        resolved = definition.resolve(full, context);
      } catch (error) {
        fail(`resolve() threw ${at}: ${String(error)}`);
        continue;
      }
      const tracks = TracksSchema.safeParse(resolved.tracks);
      if (!tracks.success) {
        fail(`invalid tracks ${at}: ${formatIssues(tracks.error.issues, ["tracks"])}`);
        continue;
      }
      if (resolved.duration !== undefined && !timeSchema(1).safeParse(resolved.duration).success) {
        fail(`invalid duration ${at}: ${JSON.stringify(resolved.duration)}`);
      }
      if (resolved.easing !== undefined && !EasingSchema.safeParse(resolved.easing).success) {
        fail(`invalid easing ${at}: ${JSON.stringify(resolved.easing)}`);
      }
      if (JSON.stringify(definition.resolve(full, context)) !== JSON.stringify(resolved)) {
        fail(`resolve() isn't deterministic ${at}`);
      }
      const problem = animationProblem(
        slide,
        { id: "animation", target: target.id, tracks: tracks.data },
        options.context,
      );
      if (problem) fail(`its tracks don't fit the target ${at}: ${problem.message}`);
      for (const [key, keyframes] of Object.entries(tracks.data)) {
        if (!CHANNELS.has(key)) continue;
        const ends = keyframes.filter((k) => k.at === 1).length > 0;
        const starts = keyframes.filter((k) => k.at === 0).length > 0;
        if (definition.kind === "entrance" && ends) {
          fail(`an entrance must land where the layer rests: "${key}" has a keyframe at 1 ${at}`);
        }
        if (definition.kind === "emphasis" && (ends || starts)) {
          fail(`emphasis must start and end at rest: "${key}" has a keyframe at 0 or 1 ${at}`);
        }
      }
    }
  }
  return report();
}
