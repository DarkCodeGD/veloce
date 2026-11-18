// @vitest-environment happy-dom
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  applyTransaction,
  createDeck,
  createSlide,
  DARK_THEME,
  type Deck,
  element,
  frame,
  type TransactionInput,
} from "@veloce/core";
import { defineElement, definePlugin, z } from "@veloce/plugin-api";
import { afterEach, describe, expect, it } from "vitest";
import { frameLayoutCss, nodeBoxCss } from "./layout.js";
import { SlideRenderer } from "./slide-renderer.js";
import { SlideView } from "./slide-view.js";

// A test plugin that records its lifecycle calls.
const calls: string[] = [];
const probe = defineElement<{ label: string }>({
  type: "probe",
  title: "Probe",
  description: "Records lifecycle calls.",
  propsSchema: z.strictObject({ label: z.string() }),
  defaultProps: { label: "x" },
  deterministic: true,
  aiDocs: "Test element.".repeat(10),
  mount(container, props) {
    calls.push(`mount:${props.label}`);
    const span = document.createElement("span");
    span.textContent = props.label;
    container.append(span);
    return {
      update: (p) => {
        calls.push(`update:${p.label}`);
        span.textContent = p.label;
      },
      seek: () => {},
      dispose: () => {
        calls.push(`dispose:${span.textContent}`);
        span.remove();
      },
    };
  },
});
const crashy = defineElement<Record<string, never>>({
  type: "crashy",
  title: "Crashy",
  description: "Throws on mount.",
  propsSchema: z.strictObject({}),
  defaultProps: {},
  deterministic: true,
  aiDocs: "Test element.".repeat(10),
  mount() {
    throw new Error("boom");
  },
});

function registry() {
  return createBuiltinRegistry().register(
    definePlugin({
      manifest: { id: "veloce.test", name: "Test", version: "0.0.0" },
      elements: [probe, crashy],
    }),
  );
}

function deck(): Deck {
  return createDeck({
    title: "Test",
    slides: [
      createSlide({
        id: "one",
        rootId: "root",
        children: [
          element("text", { content: "Title", style: "$text.h1" }, { id: "title" }),
          frame({
            id: "row",
            layout: { mode: "stack", direction: "row", gap: "$space.md" },
            children: [
              element("probe", { label: "a" }, { id: "a", width: "fill" }),
              element("probe", { label: "b" }, { id: "b", width: "fill" }),
            ],
          }),
        ],
      }),
      createSlide({
        id: "two",
        rootId: "root2",
        children: [element("probe", { label: "c" }, { id: "c" })],
      }),
    ],
  });
}

function edit(d: Deck, ops: TransactionInput["ops"]): Deck {
  const result = applyTransaction(d, { origin: "user", label: "edit", ops });
  if (!result.ok) throw new Error(result.error.message);
  return result.deck;
}

const byId = (root: ParentNode, id: string) =>
  root.querySelector<HTMLElement>(`[data-node-id="${id}"]`);

afterEach(() => {
  calls.length = 0;
  document.body.replaceChildren();
});

describe("layout → CSS", () => {
  it("maps stack, grid and absolute frames", () => {
    expect(
      frameLayoutCss({ mode: "stack", direction: "row", gap: "$space.md", align: "center" }),
    ).toMatchObject({
      display: "flex",
      "flex-direction": "row",
      gap: "var(--v-space-md)",
      "align-items": "center",
      "justify-content": "flex-start",
    });
    expect(frameLayoutCss({ mode: "grid", columns: 3, gap: 24 })).toMatchObject({
      display: "grid",
      "grid-template-columns": "repeat(3, minmax(0, 1fr))",
      "column-gap": "24px",
      "row-gap": "24px",
    });
    expect(frameLayoutCss({ mode: "absolute", padding: { x: 10 } }).padding).toBe(
      "0px 10px 0px 10px",
    );
  });

  it("sizes children by their parent's layout", () => {
    const node = element("text", {}, { id: "n" });
    const row = { mode: "stack", direction: "row" } as const;
    expect(nodeBoxCss(node, row, { width: "fill", height: "hug" })).toMatchObject({
      flex: "1 1 0px",
      "align-self": "flex-start",
      height: "fit-content",
    });
    // Regression (agent transcript): a hug-sized button in a centered column must be centered.
    const centered = nodeBoxCss(
      node,
      { mode: "stack", align: "center" },
      {
        width: "hug",
        height: "auto",
      },
    );
    expect(centered).toMatchObject({ width: "fit-content" });
    expect(centered["align-self"]).toBeUndefined();
    expect(
      nodeBoxCss(node, { mode: "grid", columns: 2, align: "end" }, { width: "hug", height: "hug" }),
    ).toMatchObject({ "justify-self": "start" });
    expect(nodeBoxCss(node, row, { width: 300, height: "fill" })).toMatchObject({
      flex: "0 0 300px",
      width: "300px",
      "align-self": "stretch",
    });
    expect(nodeBoxCss(node, { mode: "stack" }, { width: "auto", height: "auto" })).toMatchObject({
      flex: "0 1 auto",
      "min-height": "auto",
    });
    const placed = element("text", {}, { id: "p", position: { x: 40, y: 50 } });
    expect(
      nodeBoxCss(placed, { mode: "absolute", padding: 20 }, { width: "fill", height: 100 }),
    ).toMatchObject({
      position: "absolute",
      left: "calc(20px + 40px)",
      top: "calc(20px + 50px)",
      width: "calc(100% - 20px - 20px - 40px)",
      height: "100px",
    });
    expect(nodeBoxCss(node, null, { width: 1, height: 1 })).toMatchObject({
      width: "100%",
      height: "100%",
    });
  });
});

describe("SlideRenderer", () => {
  it("renders the node tree with plugin elements and theme variables", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, {
      registry: registry(),
      assetUrl: (id) => `/a/${id}`,
    });
    renderer.render(deck(), "one");
    expect(stage.style.width).toBe("1920px");
    expect(stage.style.getPropertyValue("--v-color-primary")).toBe("#4f46e5");
    expect(byId(stage, "title")?.textContent).toBe("Title");
    expect(byId(stage, "row")?.style.flexDirection).toBe("row");
    expect(
      [...(byId(stage, "row")?.children ?? [])].map((c) => c.getAttribute("data-node-id")),
    ).toEqual(["a", "b"]);
    // Plugin default sizes apply when the node doesn't say (text: fill width).
    expect(byId(stage, "title")?.style.alignSelf).toBe("stretch");
    expect(calls).toEqual(["mount:a", "mount:b"]);
  });

  it("updates incrementally: untouched nodes keep their DOM, edited elements get update()", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    let d = deck();
    renderer.render(d, "one");
    const titleEl = byId(stage, "title");
    const bEl = byId(stage, "b");
    calls.length = 0;

    d = edit(d, [{ op: "node.update", id: "a", set: { props: { label: "A!" } } }]);
    renderer.render(d, "one");
    expect(calls).toEqual(["update:A!"]);
    expect(byId(stage, "title")).toBe(titleEl);
    expect(byId(stage, "b")).toBe(bEl);

    // Reorder + remove + insert in one go; instances survive moves.
    calls.length = 0;
    d = edit(d, [
      { op: "node.move", id: "b", parentId: "row", index: 0 },
      { op: "node.remove", id: "title" },
      { op: "node.insert", parentId: "row", node: element("probe", { label: "new" }, { id: "n" }) },
    ]);
    renderer.render(d, "one");
    expect(calls).toEqual(["mount:new"]);
    expect(
      [...(byId(stage, "row")?.children ?? [])].map((c) => c.getAttribute("data-node-id")),
    ).toEqual(["b", "a", "n"]);
    expect(byId(stage, "b")).toBe(bEl);
    expect(byId(stage, "title")).toBeNull();

    // Switching theme re-skins through CSS variables without touching elements.
    calls.length = 0;
    renderer.render(edit(d, [{ op: "deck.setTheme", theme: DARK_THEME }]), "one");
    expect(stage.style.getPropertyValue("--v-color-background")).toBe("#0b0d12");
    expect(calls).toEqual([]);
  });

  it("disposes the previous slide's elements when switching slides, and everything on dispose", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    const d = deck();
    renderer.render(d, "one");
    renderer.render(d, "two");
    expect(calls).toEqual(["mount:a", "mount:b", "dispose:a", "dispose:b", "mount:c"]);
    expect(byId(stage, "row")).toBeNull();
    renderer.dispose();
    expect(calls.at(-1)).toBe("dispose:c");
    expect(stage.querySelector("[data-node-id]")).toBeNull();
  });

  it("isolates broken plugins and shows placeholders for unknown types", () => {
    const errors: string[] = [];
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, {
      registry: registry(),
      assetUrl: () => "",
      onPluginError: (e, info) =>
        errors.push(`${info.nodeId}:${info.phase}:${(e as Error).message}`),
    });
    const d = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          children: [
            element("crashy", {}, { id: "bad" }),
            element("acme.unknown", {}, { id: "unknown" }),
            element("probe", { label: "fine" }, { id: "ok" }),
          ],
        }),
      ],
    });
    renderer.render(d, "s");
    expect(errors).toEqual(["bad:mount:boom"]);
    expect(byId(stage, "bad")?.textContent).toBe('"crashy" failed to render');
    expect(byId(stage, "unknown")?.textContent).toBe('Missing element type "acme.unknown"');
    expect(byId(stage, "ok")?.textContent).toBe("fine");
  });

  it("hides hidden frames even though frames set their own display", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    renderer.render(edit(deck(), [{ op: "node.update", id: "row", set: { hidden: true } }]), "one");
    expect(byId(stage, "row")?.style.display).toBe("none");
  });
});

describe("SlideView", () => {
  it("scales the stage to fit its viewport", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientWidth", { value: 960 });
    Object.defineProperty(viewport, "clientHeight", { value: 1000 });
    document.body.append(viewport);
    const view = new SlideView(viewport, { registry: registry(), assetUrl: () => "" });
    view.render(deck(), "one");
    view.fit();
    expect(view.scale).toBe(0.5);
    expect(view.stage.style.transform).toBe("translate(0px, 230px) scale(0.5)");
    view.dispose();
    expect(viewport.children).toHaveLength(0);
  });
});
