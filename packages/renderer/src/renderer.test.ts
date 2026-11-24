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
import { frameLayoutCss, frameStyleCss, nodeBoxCss } from "./layout.js";
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
      "justify-items": "stretch",
    });
    // Grid cells align on both axes.
    expect(
      frameLayoutCss({ mode: "grid", columns: 3, justify: "center", align: "end" }),
    ).toMatchObject({ "justify-items": "center", "align-items": "flex-end" });
    expect(frameLayoutCss({ mode: "stack", padding: { x: 10 } }).padding).toBe("0px 10px 0px 10px");
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
    // Centred across the cell: hug fits its content and follows justify-items.
    const inCell = nodeBoxCss(
      node,
      { mode: "grid", columns: 2, justify: "center" },
      { width: "hug", height: "hug" },
    );
    expect(inCell["justify-self"]).toBeUndefined();
    expect(inCell["align-self"]).toBe("start");
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
      left: "40px", // from the frame's edge: padding only spaces a flow
      top: "50px",
      width: "calc(100% - 40px)",
      height: "100px",
    });
    expect(nodeBoxCss(node, null, { width: 1, height: 1 })).toMatchObject({
      width: "100%",
      height: "100%",
    });
  });

  it("takes free layers out of stacks and grids, at their own position", () => {
    const free = element("text", {}, { id: "f", positioning: "free", position: { x: 40, y: 50 } });
    const padded = { mode: "stack", padding: { x: 10, y: 20 } } as const;
    const css = nodeBoxCss(free, padded, { width: 300, height: "hug" });
    expect(css).toMatchObject({
      position: "absolute",
      left: "40px",
      top: "50px",
      width: "300px",
      height: "auto",
    });
    expect(css.flex).toBeUndefined(); // no flex sizing: it isn't in the flow
    expect(
      nodeBoxCss(free, { mode: "grid", columns: 3 }, { width: "hug", height: 80 }),
    ).toMatchObject({ position: "absolute", width: "max-content", height: "80px" });
    // `positioning: "auto"` (and a stray position) stays in the flow.
    const auto = { ...free, positioning: "auto" as const };
    expect(nodeBoxCss(auto, padded, { width: 300, height: "hug" }).position).toBe("relative");
    // The root ignores it: it always fills the stage.
    expect(nodeBoxCss(free, null, { width: 1, height: 1 }).left).toBe("0");
  });

  it("draws frame strokes inside the edge without taking room", () => {
    const framed = frame({ id: "f", style: { stroke: { color: "#ff0000", width: 4 } } });
    const css = frameStyleCss(framed, () => "");
    expect(css).toMatchObject({ outline: "4px solid #ff0000", "outline-offset": "-4px" });
    expect(css.border).toBeUndefined();
    // A free frame's padding would only shift its free children: it isn't applied.
    expect(frameLayoutCss({ mode: "absolute", padding: 40 }).padding).toBe("0px");
  });

  it("measures anchored free layers from the right, the bottom or the middle", () => {
    const padded = { mode: "absolute", padding: { x: 10, y: 20 } } as const;
    const badge = element(
      "text",
      {},
      { id: "b", anchor: { x: "end", y: "start" }, position: { x: 16, y: 8 }, rotation: 15 },
    );
    const css = nodeBoxCss(badge, padded, { width: "fill", height: "hug" });
    expect(css).toMatchObject({
      right: "16px",
      top: "8px",
      width: "calc(100% - 16px)", // fill: from the left edge to its inset
      transform: "rotate(15deg)",
    });
    expect(css.left).toBeUndefined();

    const centered = element(
      "text",
      {},
      { id: "c", anchor: { x: "center", y: "end" }, position: { x: -30, y: 12 }, rotation: 15 },
    );
    expect(nodeBoxCss(centered, padded, { width: 200, height: 40 })).toMatchObject({
      left: "calc(50% + -30px)",
      bottom: "12px",
      transform: "translate(-50%, 0) rotate(15deg)",
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

  it("marks the stage with the deck's language, and drops it when it's cleared (D76)", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    let d = deck();
    renderer.render(d, "one");
    expect(stage.hasAttribute("lang")).toBe(false);
    d = edit(d, [{ op: "deck.updateMeta", set: { language: "pt-BR" } }]);
    renderer.render(d, "one");
    expect(stage.lang).toBe("pt-BR");
    d = edit(d, [{ op: "deck.updateMeta", set: { language: null } }]);
    renderer.render(d, "one");
    expect(stage.hasAttribute("lang")).toBe(false);
    renderer.dispose();
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
    expect(view.fitted).toBe(true);
    view.dispose();
    expect(viewport.children).toHaveLength(0);
  });

  it("draws the stage where a camera says, keeps it on resize, and fits again on null", () => {
    const viewport = document.createElement("div");
    let width = 960;
    Object.defineProperty(viewport, "clientWidth", { get: () => width });
    Object.defineProperty(viewport, "clientHeight", { value: 1000 });
    document.body.append(viewport);
    const view = new SlideView(viewport, { registry: registry(), assetUrl: () => "" });
    view.render(deck(), "one");
    view.setCamera({ scale: 2, x: -100, y: 40 });
    expect(view.fitted).toBe(false);
    expect(view.scale).toBe(2);
    expect(view.camera).toEqual({ scale: 2, x: -100, y: 40 });
    expect(view.stage.style.transform).toBe("translate(-100px, 40px) scale(2)");
    width = 480; // the window shrinks: a zoomed canvas stays where it is
    view.fit();
    expect(view.camera).toEqual({ scale: 2, x: -100, y: 40 });
    view.setCamera(null); // zoom to fit
    expect(view.fitted).toBe(true);
    expect(view.camera).toEqual(view.fitCamera);
    expect(view.scale).toBe(0.25);
    view.dispose();
    expect(viewport.children).toHaveLength(0);
  });
});

describe("fields and the footer (D97)", () => {
  const NOW = new Date(2026, 10, 24, 12);
  const numbered = (d: Deck) =>
    edit(d, [
      {
        op: "node.insert",
        parentId: "root2",
        node: element(
          "text",
          { content: [{ runs: [{ text: "Slide " }, { text: "?", field: "slideNumber" }] }] },
          { id: "num" },
        ),
      },
    ]);
  const setup = () => {
    const stage = document.createElement("div");
    document.body.append(stage);
    const renderer = new SlideRenderer(stage, {
      registry: registry(),
      assetUrl: () => "",
      now: () => NOW,
    });
    return { stage, renderer };
  };

  it("draws a field's value, and re-draws it when another slide moves", () => {
    const { stage, renderer } = setup();
    let d = numbered(deck());
    renderer.render(d, "two");
    expect(byId(stage, "num")?.textContent).toBe("Slide 2");
    d = edit(d, [{ op: "slide.move", id: "two", index: 0 }]); // slide "two" itself is untouched
    renderer.render(d, "two");
    expect(byId(stage, "num")?.textContent).toBe("Slide 1");
    expect(calls.filter((c) => c.startsWith("update"))).toEqual([]); // probes don't use fields
    renderer.dispose();
  });

  it("draws the deck's footer over slides that show it, click-through, never measured", () => {
    const { stage, renderer } = setup();
    let d = edit(deck(), [
      { op: "deck.setFooter", footer: { text: "Acme", slideNumber: true, date: true } },
    ]);
    renderer.render(d, "two");
    const footer = byId(stage, "_footer");
    expect(footer?.style.pointerEvents).toBe("none");
    expect(footer?.previousElementSibling).toBe(byId(stage, "root2")); // drawn over the slide
    expect(byId(stage, "_footer-text")?.textContent).toBe("Acme");
    expect(byId(stage, "_footer-number")?.textContent).toBe("2");
    expect(byId(stage, "_footer-date")?.textContent).toBe("November 24, 2026");

    d = edit(d, [{ op: "slide.update", id: "two", set: { hideFooter: true } }]);
    renderer.render(d, "two");
    expect(byId(stage, "_footer")).toBeNull();
    d = edit(d, [{ op: "slide.update", id: "two", set: { hideFooter: null } }]);
    renderer.render(d, "two");
    expect(byId(stage, "_footer-number")?.textContent).toBe("2");
    d = edit(d, [{ op: "deck.setFooter", footer: { slideNumber: true } }]);
    renderer.render(d, "two");
    expect(byId(stage, "_footer-text")?.textContent).toBe(""); // the slot stays, empty
    d = edit(d, [{ op: "deck.setFooter", footer: null }]);
    renderer.render(d, "two");
    expect(byId(stage, "_footer")).toBeNull();
    renderer.dispose();
  });

  it("brings the footer back after the slide was gone", () => {
    const { stage, renderer } = setup();
    const d = edit(deck(), [{ op: "deck.setFooter", footer: { slideNumber: true } }]);
    renderer.render(d, "two");
    renderer.render(d, "missing"); // clears the stage
    expect(byId(stage, "_footer")).toBeNull();
    renderer.render(d, "two");
    expect(byId(stage, "_footer-number")?.textContent).toBe("2");
    renderer.dispose();
  });
});

describe("motion: drawn on top of the rest position (D83 §5, D103)", () => {
  const size = { width: 200, height: 100 } as const;
  const stack = { mode: "stack" as const };

  it("leaves a node at rest with exactly the CSS it had before motion existed", () => {
    const centred = element(
      "text",
      {},
      {
        id: "c",
        rotation: 12.345678,
        opacity: 1 / 3,
        positioning: "free",
        anchor: { x: "center", y: "center" },
        position: { x: 0, y: 0 },
      },
    );
    const css = nodeBoxCss(centred, stack, size);
    expect(css.transform).toBe("translate(-50%, -50%) rotate(12.345678deg)");
    expect(css.opacity).toBe(String(1 / 3)); // document values stay exact
    expect(css.filter).toBeUndefined();
    expect(nodeBoxCss(centred, stack, size, {})).toEqual(css);
    expect(nodeBoxCss(centred, stack, size, { x: 0, scale: 1, opacity: 1 })).toEqual(css);
    expect(nodeBoxCss(element("text", {}, { id: "p" }), stack, size).transform).toBeUndefined();
  });

  it("orders the transform: anchor shift, move, rotation, own-axis flips, scale", () => {
    const sticker = element(
      "text",
      {},
      {
        id: "s",
        rotation: 30,
        positioning: "free",
        anchor: { x: "center" },
        position: { x: 0, y: 0 },
      },
    );
    const css = nodeBoxCss(sticker, stack, size, {
      x: 40,
      y: -10,
      rotate: 15,
      rotateX: 20,
      rotateY: 45,
      scale: 2,
      scaleY: 0.5,
    });
    expect(css.transform).toBe(
      "translate(-50%, 0) translate(40px, -10px) rotate(45deg) rotateY(45deg) rotateX(20deg) scale(2, 1)",
    );
    expect(nodeBoxCss(sticker, stack, size, { z: 30 }).transform).toBe(
      "translate(-50%, 0) translate3d(0px, 0px, 30px) rotate(30deg)",
    );
    expect(nodeBoxCss(sticker, stack, size, { scale: 1.5 }).transform).toBe(
      "translate(-50%, 0) rotate(30deg) scale(1.5)",
    );
  });

  it("multiplies opacity, adds blur, and rounds animated values for short, stable strings", () => {
    const faded = element("text", {}, { id: "f", opacity: 0.5 });
    expect(nodeBoxCss(faded, stack, size, { opacity: 0.5 }).opacity).toBe("0.25");
    expect(nodeBoxCss(faded, stack, size, { blur: 8 }).filter).toBe("blur(8px)");
    expect(nodeBoxCss(faded, stack, size, { x: 1 / 3 }).transform).toBe("translate(0.3333px, 0px)");
    // A hidden node stays hidden whatever its motion.
    const hidden = element("text", {}, { id: "h", hidden: true });
    expect(nodeBoxCss(hidden, stack, size, { opacity: 1, x: 5 }).display).toBe("none");
  });

  it("draws motion on the layers given, leaves the rest alone, and restores rest exactly", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    renderer.render(deck(), "one");
    const a = byId(stage, "a");
    const title = byId(stage, "title");
    const restA = a?.style.cssText;
    const restTitle = title?.style.cssText;
    calls.length = 0;

    renderer.setMotion(new Map([["a", { y: 24, opacity: 0.5, blur: 4 }]]));
    expect(a?.style.transform).toBe("translate(0px, 24px)");
    expect(a?.style.opacity).toBe("0.5");
    expect(a?.style.filter).toBe("blur(4px)");
    expect(title?.style.cssText).toBe(restTitle);
    expect(calls).toEqual([]); // no plugin calls: motion never re-renders elements

    renderer.setMotion(new Map());
    expect(a?.style.cssText).toBe(restA);
    renderer.dispose();
  });

  it("keeps a layer's motion when an edit restyles it mid-playback", () => {
    const stage = document.createElement("div");
    const renderer = new SlideRenderer(stage, { registry: registry(), assetUrl: () => "" });
    let d = deck();
    renderer.render(d, "one");
    renderer.setMotion(new Map([["b", { x: 100, rotate: 10 }]]));

    // The edit restyles "b" (applyCss clears the element's inline style first).
    d = edit(d, [{ op: "node.update", id: "b", set: { rotation: 5, opacity: 0.8 } }]);
    renderer.render(d, "one");
    const b = byId(stage, "b");
    expect(b?.style.transform).toBe("translate(100px, 0px) rotate(15deg)");
    expect(b?.style.opacity).toBe("0.8");

    // A layer an edit adds starts with the motion the clock already gave it.
    renderer.setMotion(new Map([["late", { x: 7 }]]));
    d = edit(d, [
      {
        op: "node.insert",
        parentId: "row",
        node: element("probe", { label: "late" }, { id: "late" }),
      },
    ]);
    renderer.render(d, "one");
    expect(byId(stage, "late")?.style.transform).toBe("translate(7px, 0px)");
    renderer.dispose();
  });

  it("only touches layers whose motion changed", () => {
    const stage = document.createElement("div");
    const view = new SlideView(stage, { registry: registry(), assetUrl: () => "" });
    view.render(deck(), "one");
    view.setMotion(new Map([["a", { x: 10 }]]));
    const a = byId(stage, "a");
    let writes = 0;
    const style = a?.style as CSSStyleDeclaration;
    const setProperty = style.setProperty.bind(style);
    style.setProperty = (...args: Parameters<CSSStyleDeclaration["setProperty"]>) => {
      writes++;
      setProperty(...args);
    };
    view.setMotion(new Map([["a", { x: 10, y: 0 }]])); // draws the same: no writes
    expect(writes).toBe(0);
    view.setMotion(new Map([["a", { x: 11 }]]));
    expect(writes).toBeGreaterThan(0);
    view.dispose();
  });
});
