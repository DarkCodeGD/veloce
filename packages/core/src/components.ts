/**
 * Components (D94): a subtree saved under a name, inserted again as a plain copy.
 *
 * Copy on insert, never linked: `instantiateComponent` returns an ordinary node with fresh
 * IDs, so the document never points at a component, and undo, morph, lint and export treat
 * the copy like anything else. Editing a component later doesn't touch earlier copies.
 *
 * Params: `with: { title: "Q3" }` writes "Q3" into every field the `title` param targets
 * (`"title.props.content"`: the `props.content` of the template node `title`). The copy is
 * then validated like any node, and a bad value is reported against its param
 * (`with.title: …`), so whoever inserted it knows which value to fix.
 *
 * IDs: the copy's root takes the given ID (or a generated one), and each inner node gets
 * `<root>-<template ID>` while that's free: a card saved as `card` / `card-title`, inserted
 * as `c1`, has `c1` / `c1-title`, so an agent can edit the title later without looking it up.
 */
import type { ElementValidator } from "./checks.js";
import { VeloceError } from "./errors.js";
import { createId } from "./ids.js";
import { isPlainObject, type JsonObject } from "./json.js";
import { BUILTIN_LAYOUTS } from "./layouts.js";
import type { Component } from "./schema/component.js";
import type { Deck, Slide } from "./schema/deck.js";
import { type FrameNode, MAX_DEPTH, type Node, NodeSchema } from "./schema/node.js";
import { suggest } from "./suggest.js";
import { subtreeHeight, walkNodes } from "./tree.js";

type WithComponents = Pick<Deck, "components">;

/** A param target, split: `"title.props.content"` → `{ node: "title", field: ["props", "content"] }`. */
export interface ParamTarget {
  node: string;
  field: string[];
}

export function parseTarget(target: string): ParamTarget {
  const [node = "", ...field] = target.split(".");
  return { node, field };
}

/** Fields a param can't write: they'd change what the node is, not how it looks. */
const FORBIDDEN_FIELDS: Record<string, string> = {
  id: "IDs are given on insert",
  kind: "a node can't switch between frame and element",
  type: "an element's type is fixed",
  children: "params write fields, not children",
};
/** Field names that mean something to JavaScript objects themselves. */
const UNSAFE_FIELDS = new Set(["constructor", "prototype"]);

/** The component saved under exactly `name` (own keys only: "constructor" is just a name). */
export function getComponent(deck: WithComponents, name: string): Component | undefined {
  const all = deck.components;
  return all && Object.hasOwn(all, name) ? all[name] : undefined;
}

export function componentNames(deck: WithComponents): string[] {
  return Object.keys(deck.components ?? {});
}

/**
 * Another component whose name differs from `name` only in case ("Card" vs "card"). Names
 * are typed by agents and people, so two that look the same would be a trap.
 */
export function caseClash(deck: WithComponents, name: string): string | undefined {
  const lower = name.toLowerCase();
  return componentNames(deck).find((n) => n !== name && n.toLowerCase() === lower);
}

/** "No component "crad". Did you mean "card"?" with the names there are (built-in layouts too). */
export function componentNotFound(deck: WithComponents, name: string, path?: string): VeloceError {
  const names = [...new Set([...componentNames(deck), ...Object.keys(BUILTIN_LAYOUTS)])];
  const close = suggest(name, names);
  const hint = close.length
    ? `Did you mean ${close.map((c) => `"${c}"`).join(" or ")}?`
    : names.length
      ? `This deck's components: ${names
          .slice(0, 20)
          .map((n) => `"${n}"`)
          .join(", ")}. list_components shows their params.`
      : "This deck has no components yet. Save one with save_component.";
  return new VeloceError("NOT_FOUND", `No component "${name}" in this deck`, {
    hint,
    ...(path !== undefined && { path }),
  });
}

/**
 * What a schema can't check: unique IDs inside the template, nesting depth (a copy sits at
 * least one level below a slide's root), and params that target real nodes and fields an
 * edit may change. Null when it's sound. Elements' props are the plugins' job (`ApplyContext`).
 */
export function componentProblem(component: Component): VeloceError | null {
  const nodes = new Map<string, Node>();
  for (const { node } of walkNodes(component.node)) {
    if (nodes.has(node.id)) {
      return new VeloceError("CONFLICT", `ID "${node.id}" appears twice in the component`, {
        hint: "IDs inside a component must be unique (copies get fresh ones on insert).",
        path: "component.node",
      });
    }
    nodes.set(node.id, node);
  }
  if (component.slide && component.node.kind !== "frame") {
    return new VeloceError("INVALID", "A slide layout's node must be a frame (the slide's root)", {
      hint: "Save a slide's root frame as the layout, or leave out `slide` for a layer component.",
      path: "component.node",
    });
  }
  if (component.slot !== undefined && nodes.get(component.slot)?.kind !== "frame") {
    const frames = [...nodes.values()].filter((n) => n.kind === "frame").map((n) => n.id);
    return new VeloceError(
      nodes.has(component.slot) ? "INVALID" : "NOT_FOUND",
      `The slot "${component.slot}" isn't a frame in the component`,
      {
        hint: frames.length
          ? `The slot is the frame that children given with \`use\` go into: one of ${frames
              .slice(0, 15)
              .map((f) => `"${f}"`)
              .join(", ")}.`
          : "The component has no frames: leave out `slot`.",
        path: "component.slot",
      },
    );
  }
  // A layout's root is a slide's root (depth 0); anything else sits at least one level down.
  if ((component.slide ? 0 : 1) + subtreeHeight(component.node) > MAX_DEPTH) {
    return new VeloceError("FORBIDDEN", `The component nests too deep (max ${MAX_DEPTH} levels)`, {
      hint: "Flatten the structure: use a grid or stack layout instead of nesting frames.",
      path: "component.node",
    });
  }
  for (const [param, { targets }] of Object.entries(component.params ?? {})) {
    for (const [i, target] of targets.entries()) {
      const path = `component.params.${param}.targets[${i}]`;
      const { node: id, field } = parseTarget(target);
      const node = nodes.get(id);
      if (!node) {
        const close = suggest(id, [...nodes.keys()]);
        return new VeloceError(
          "NOT_FOUND",
          `Param "${param}" targets node "${id}", which isn't in the component`,
          {
            hint: close.length
              ? `Did you mean "${close[0]}"? A target is "<node ID>.<field>", e.g. "${close[0]}.props.content".`
              : `A target is "<node ID>.<field>" with a node inside the component: ${[
                  ...nodes.keys(),
                ]
                  .slice(0, 15)
                  .map((n) => `"${n}"`)
                  .join(", ")}.`,
            path,
          },
        );
      }
      const [first = ""] = field;
      const why = Object.hasOwn(FORBIDDEN_FIELDS, first) ? FORBIDDEN_FIELDS[first] : undefined;
      if (why || field.some((f) => UNSAFE_FIELDS.has(f))) {
        return new VeloceError("FORBIDDEN", `Param "${param}" can't target "${target}"`, {
          hint: why
            ? `${why[0]?.toUpperCase()}${why.slice(1)}. Target a field like "${id}.props.content" or "${id}.style.fill".`
            : "Pick a real field of the node, like props.content or style.fill.",
          path,
        });
      }
      if (node.kind === "element" && (first === "layout" || first === "style")) {
        return new VeloceError("FORBIDDEN", `Param "${param}" targets "${target}"`, {
          hint: `"${id}" is a ${node.type} element: its look is in props (e.g. "${id}.props.fill"). Only frames have ${first}.`,
          path,
        });
      }
      if (node.kind === "frame" && first === "props") {
        return new VeloceError("FORBIDDEN", `Param "${param}" targets "${target}"`, {
          hint: `"${id}" is a frame: it has layout and style (e.g. "${id}.style.fill"), not props.`,
          path,
        });
      }
    }
  }
  return null;
}

export interface InstantiateOptions {
  /** Param values, by param name. `null` removes the field (back to its default). */
  with?: Readonly<Record<string, unknown>> | undefined;
  /** The copy's root ID. Default: a generated one. */
  id?: string | undefined;
  /** IDs in use (the deck's, earlier copies'): inner IDs avoid them, and new ones are added. */
  taken?: Set<string> | undefined;
  /** Checks the elements a param wrote into (`registry.validateElement`). */
  validateElement?: ElementValidator | undefined;
  /** Where the `use` sits in the caller's input, for error paths (`slide.children[2]`). */
  at?: string | undefined;
  /** What inner IDs start with (`<prefix>-<template ID>`). Default: the copy's root ID. */
  prefix?: string | undefined;
  /** Nodes for the component's slot, in place of its placeholder (already plain, with IDs). */
  children?: readonly Node[] | undefined;
}

/**
 * A plain copy of `component` with fresh IDs and the params written in. Throws a
 * `VeloceError` naming the param when a value doesn't fit (`with.title`), or naming the
 * unknown param when `with` has one.
 */
export function instantiateComponent(
  name: string,
  component: Component,
  options: InstantiateOptions = {},
): Node {
  const at = options.at ? `${options.at}.` : "";
  const params = component.params ?? {};
  const given = Object.entries(options.with ?? {}).filter(([, v]) => v !== undefined);
  for (const [param] of given) {
    if (!Object.hasOwn(params, param)) {
      const names = Object.keys(params);
      const close = suggest(param, names);
      throw new VeloceError("INVALID", `Component "${name}" has no param "${param}"`, {
        hint: close.length
          ? `Did you mean "${close[0]}"?`
          : names.length
            ? `Its params: ${names.map((n) => `"${n}"`).join(", ")}.`
            : `It has no params: leave out "with", then change the copy with node.update.`,
        path: `${at}with.${param}`,
      });
    }
  }

  // The template's own node objects, by ID, in a copy we're free to write into.
  const copy = cloneJson(component.node);
  const byId = new Map<string, Node>();
  for (const { node } of walkNodes(copy)) byId.set(node.id, node);
  for (const [param, value] of given) {
    for (const target of params[param]?.targets ?? []) {
      const { node, field } = parseTarget(target);
      const into = byId.get(node);
      if (into) writeField(into as unknown as JsonObject, field, value);
    }
  }

  const problem = firstIssue(copy, component, name);
  if (problem) throw located(problem, at);
  checkWrittenElements(copy, component, name, given, options.validateElement, at);
  if (options.children && component.slot === undefined) {
    throw new VeloceError("INVALID", `Component "${name}" takes no children (it has no slot)`, {
      hint: "Leave out `children`, then add nodes to the copy with node.insert into one of its frames.",
      path: `${at}children`,
    });
  }
  return withFreshIds(copy, {
    rootId: options.id,
    prefix: options.prefix,
    taken: options.taken ?? new Set(),
    slot:
      options.children && component.slot
        ? { id: component.slot, children: options.children }
        : undefined,
  });
}

/**
 * A new slide from a slide layout (D95): its root frame a copy of the layout's, with the
 * params written in and `children` in its slot; inner IDs start with the slide's ID
 * (`s3-title`), so the agent that named the slide can edit them right away.
 */
export function instantiateSlide(
  name: string,
  component: Component,
  slideId: string,
  options: Omit<InstantiateOptions, "id" | "prefix"> = {},
): Slide {
  if (!component.slide) {
    throw new VeloceError("INVALID", `"${name}" is a component, not a slide layout`, {
      hint: `Put it inside a slide instead: { "use": "${name}" } among the slide's children.`,
      ...(options.at && { path: `${options.at}.use` }),
    });
  }
  const taken = options.taken ?? new Set<string>();
  taken.add(slideId);
  const root = instantiateComponent(name, component, { ...options, taken, prefix: slideId });
  const background = component.slide.background;
  return {
    id: slideId,
    ...(background !== undefined && { background: cloneJson(background) }),
    root: root as FrameNode,
  };
}

/** A deep copy of a JSON value (documents are JSON; core has no `structuredClone` typings). */
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Writes `value` at `field` inside `target`, creating objects on the way (own keys only). */
function writeField(target: JsonObject, field: readonly string[], value: unknown): void {
  let obj = target;
  for (const key of field.slice(0, -1)) {
    const next = Object.hasOwn(obj, key) ? obj[key] : undefined;
    if (isPlainObject(next)) obj = next;
    else {
      const created: JsonObject = {};
      obj[key] = created;
      obj = created;
    }
  }
  const last = field.at(-1);
  if (last === undefined) return;
  if (value === null) delete obj[last];
  else obj[last] = cloneJson(value);
}

/** The param that writes at (or into) `field` of template node `node`, if any. */
function paramAt(component: Component, node: string, field: readonly string[]): string | undefined {
  for (const [param, { targets }] of Object.entries(component.params ?? {})) {
    for (const target of targets) {
      const t = parseTarget(target);
      if (t.node !== node) continue;
      const n = Math.min(t.field.length, field.length);
      if (t.field.slice(0, n).every((f, i) => f === field[i])) return param;
    }
  }
  return undefined;
}

/** The first schema problem in the filled-in copy, blamed on a param when one wrote there. */
function firstIssue(copy: Node, component: Component, name: string): VeloceError | null {
  const parsed = NodeSchema.safeParse(copy);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (!issue) return null;
  // Walk `children[i]` steps down to the node, the rest is its field.
  let node: Node = copy;
  let i = 0;
  const path = issue.path;
  while (path[i] === "children" && typeof path[i + 1] === "number" && node.kind === "frame") {
    const child: Node | undefined = node.children[path[i + 1] as number];
    if (!child) break;
    node = child;
    i += 2;
  }
  const field = path.slice(i).map(String);
  const param = paramAt(component, node.id, field);
  const where = field.length ? `${node.id}.${field.join(".")}` : node.id;
  return param
    ? new VeloceError("INVALID", `"${param}" doesn't fit ${where}: ${issue.message}`, {
        hint: `Pass a value of the right kind for ${where} in with.${param}.`,
        path: `with.${param}`,
      })
    : new VeloceError("INVALID", `Component "${name}" is invalid at ${where}: ${issue.message}`, {
        hint: "Save the component again with a valid node (save_component).",
      });
}

/** Elements a param wrote into still pass their plugin's checks; blamed on that param. */
function checkWrittenElements(
  copy: Node,
  component: Component,
  name: string,
  given: ReadonlyArray<readonly [string, unknown]>,
  validate: ElementValidator | undefined,
  at: string,
): void {
  if (!validate || given.length === 0) return;
  const written = new Map<string, string>(); // template node ID → a param that wrote there
  for (const [param] of given) {
    for (const target of component.params?.[param]?.targets ?? []) {
      const id = parseTarget(target).node;
      if (!written.has(id)) written.set(id, param);
    }
  }
  for (const { node } of walkNodes(copy)) {
    const param = written.get(node.id);
    if (!param || node.kind !== "element") continue;
    const check = validate(node.type, node.props);
    if (!check.ok) {
      throw new VeloceError(
        "INVALID",
        `"${param}" doesn't fit the ${node.type} element "${node.id}" of component "${name}": ${check.message}`,
        { hint: `Pass a value of the right kind in with.${param}.`, path: `${at}with.${param}` },
      );
    }
  }
}

function located(error: VeloceError, at: string): VeloceError {
  if (!at || !error.path) return error;
  return new VeloceError(error.code, error.message, {
    ...(error.hint !== undefined && { hint: error.hint }),
    path: `${at}${error.path}`,
  });
}

interface Renaming {
  rootId: string | undefined;
  prefix: string | undefined;
  taken: Set<string>;
  /** The slot's template ID and what fills it (kept as given: they have their own IDs). */
  slot: { id: string; children: readonly Node[] } | undefined;
}

/** Re-IDs the copy (see the module comment), recording every new ID in `taken`. */
function withFreshIds(copy: Node, { rootId, prefix, taken, slot }: Renaming): Node {
  const fresh = (): string => {
    let id = createId("nd");
    while (taken.has(id)) id = createId("nd");
    return id;
  };
  const templateRoot = copy.id;
  const root = rootId ?? fresh();
  taken.add(root);
  const idFor = (templateId: string): string => {
    if (templateId === templateRoot) return root;
    const suffix = templateId.startsWith(`${templateRoot}-`)
      ? templateId.slice(templateRoot.length + 1)
      : templateId;
    const derived = `${prefix ?? root}-${suffix}`;
    const id = derived.length <= 64 && !taken.has(derived) ? derived : fresh();
    taken.add(id);
    return id;
  };
  const visit = (node: Node): Node => {
    if (node.kind !== "frame") return { ...node, id: idFor(node.id) };
    const children = slot && node.id === slot.id ? [...slot.children] : node.children.map(visit);
    return { ...node, id: idFor(node.id), children };
  };
  return visit(copy);
}
