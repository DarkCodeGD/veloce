import { createSlide, element, frame, type Node, NodeSchema } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_INSERTABLES,
  drawnRect,
  type ElementInfo,
  type Insertable,
  insertables,
  insertCommand,
  menuSections,
  newLayer,
  placeNew,
  rememberRecent,
  searchInsertables,
} from "./insert.js";
import type { FrameSnapshot } from "./reorder.js";
import { indexSlide } from "./slide-index.js";

const ELEMENTS: ElementInfo[] = [
  {
    type: "text",
    title: "Text",
    defaultProps: { content: "Text", style: "$text.body" },
    defaultSize: { width: "fill", height: "hug" },
  },
  { type: "shape", title: "Shape", defaultProps: { shape: "rect", fill: "$color.primary" } },
  { type: "image", title: "Image", defaultProps: { asset: "asset:0", alt: "" } },
];
const item = (id: string) => BUILTIN_INSERTABLES.find((i) => i.id === id) as Insertable;

/**
 * A 1920×1080 slide: a column stack (the default) holding a title and a free "board" frame at
 * (960, 200, 800×600) with one free child.
 */
const title = element("text", { content: "Title" }, { id: "title" });
const pin = element(
  "shape",
  { shape: "rect" },
  { id: "pin", width: 40, height: 40, position: { x: 10, y: 10 } },
);
const board = frame({
  id: "board",
  layout: { mode: "absolute" },
  width: 800,
  height: 600,
  children: [pin],
});
const slide = createSlide({ rootId: "root", children: [title, board] });
const index = indexSlide(slide);
const frames: FrameSnapshot[] = [
  {
    id: "root",
    parentId: null,
    depth: 0,
    rect: { x: 0, y: 0, w: 1920, h: 1080 },
    content: { x: 96, y: 96, w: 1728, h: 888 },
    flow: "column",
    locked: false,
    children: [
      { id: "title", rect: { x: 96, y: 100, w: 1728, h: 80 }, free: false },
      { id: "board", rect: { x: 960, y: 200, w: 800, h: 600 }, free: false },
    ],
  },
  {
    id: "board",
    parentId: "root",
    depth: 1,
    rect: { x: 960, y: 200, w: 800, h: 600 },
    content: { x: 960, y: 200, w: 800, h: 600 },
    flow: "absolute",
    locked: false,
    children: [{ id: "pin", rect: { x: 970, y: 210, w: 40, h: 40 }, free: true }],
  },
];

const insertOp = (ops: unknown[]) =>
  ops[0] as { op: string; parentId: string; index?: number; node: Node };

describe("adding layers by hand (D81)", () => {
  it("lists the built-ins, then any other element type a plugin registers", () => {
    const all = insertables([
      ...ELEMENTS,
      { type: "chart", title: "Chart", description: "Bar and line charts", defaultProps: {} },
    ]);
    expect(all.map((i) => i.id)).toEqual([
      "text",
      "frame",
      "rect",
      "ellipse",
      "triangle",
      "polygon",
      "star",
      "arrow",
      "chevron",
      "line",
      "arrow-line",
      "image",
      "element:chart",
    ]);
    expect(all.at(-1)).toMatchObject({
      label: "Chart",
      group: "Plugins",
      make: { kind: "element", type: "chart" },
    });
  });

  it("searches by word starts in labels and keywords, label matches first", () => {
    const ids = (q: string) => searchInsertables(BUILTIN_INSERTABLES, q).map((i) => i.id);
    expect(ids("rec")).toEqual(["rect"]);
    expect(ids("circ")).toEqual(["ellipse"]);
    expect(ids("  ")).toHaveLength(BUILTIN_INSERTABLES.length);
    expect(ids("box")).toEqual(["frame", "rect"]); // keywords, menu order kept
    expect(ids("shape e")).toEqual(["ellipse"]); // every word must match
    expect(ids("ect")).toEqual([]); // starts of words only
    expect(ids("i")).toEqual(["image"]); // "image" leads; nothing else has an i-word
  });

  it("remembers the last few used, most recent first", () => {
    expect(rememberRecent([], "rect")).toEqual(["rect"]);
    expect(rememberRecent(["text", "rect", "frame"], "rect")).toEqual(["rect", "text", "frame"]);
    expect(rememberRecent(["a", "b", "c"], "d")).toEqual(["d", "a", "b"]);
  });

  it("makes valid layers: theme-styled frames, sized shapes, text that fits where it lands", () => {
    const f = newLayer(item("frame"), ELEMENTS, null, false);
    expect(f).toMatchObject({
      kind: "frame",
      name: "Frame",
      width: 400,
      height: 300,
      style: { fill: "$color.surface" },
    });
    const e = newLayer(item("ellipse"), ELEMENTS, null, false);
    expect(e).toMatchObject({
      type: "shape",
      name: "Ellipse",
      width: 200,
      height: 200,
      props: { shape: "ellipse", fill: "$color.primary" },
    });
    const drawn = newLayer(item("rect"), ELEMENTS, { w: 120.4, h: 0.2 }, true);
    expect(drawn).toMatchObject({ width: 120, height: 1 });
    // Text: the plugin's column default in a flow; as wide as its words in a free frame.
    const flowText = newLayer(item("text"), ELEMENTS, null, false);
    expect(flowText).not.toHaveProperty("width");
    expect(newLayer(item("text"), ELEMENTS, null, true)).toMatchObject({
      width: "hug",
      height: "hug",
    });
    expect(newLayer(item("text"), ELEMENTS, { w: 300, h: 50 }, true)).toMatchObject({
      width: 300,
      height: "hug",
    });
    expect(newLayer(item("image"), ELEMENTS, null, false)).toBeNull(); // needs a file
    for (const node of [f, e, drawn, flowText])
      expect(NodeSchema.safeParse(node).success).toBe(true);
    // Defaults are copied, never shared with the plugin's definition.
    (flowText as { props: Record<string, unknown> }).props.content = "changed";
    expect(ELEMENTS[0]?.defaultProps.content).toBe("Text");
  });

  it("lands in a stack at the slot nearest the point", () => {
    const shape = newLayer(item("rect"), ELEMENTS, null, false) as Node;
    expect(placeNew(index, frames, shape, { point: { x: 400, y: 60 } }, [])).toEqual({
      parentId: "root",
      index: 0,
    });
    expect(placeNew(index, frames, shape, { point: { x: 400, y: 190 } }, [])).toEqual({
      parentId: "root",
      index: 1,
    });
    expect(placeNew(index, frames, shape, { point: { x: 400, y: 1000 } }, [])).toEqual({
      parentId: "root",
      index: 2,
    });
  });

  it("skips free layers in a stack: they aren't slots", () => {
    // A column: a, then a free badge drawn on top, then b.
    const a = element("text", { content: "A" }, { id: "a" });
    const badge = element("text", { content: "!" }, { id: "badge", positioning: "free" });
    const b = element("text", { content: "B" }, { id: "b" });
    const col = indexSlide(createSlide({ rootId: "root", children: [a, badge, b] }));
    const snapshot: FrameSnapshot[] = [
      {
        id: "root",
        parentId: null,
        depth: 0,
        rect: { x: 0, y: 0, w: 1920, h: 1080 },
        content: { x: 0, y: 0, w: 1920, h: 1080 },
        flow: "column",
        locked: false,
        children: [
          { id: "a", rect: { x: 0, y: 0, w: 1920, h: 100 }, free: false },
          { id: "badge", rect: { x: 0, y: 0, w: 50, h: 50 }, free: true },
          { id: "b", rect: { x: 0, y: 200, w: 1920, h: 100 }, free: false },
        ],
      },
    ];
    const shape = newLayer(item("rect"), ELEMENTS, null, false) as Node;
    // Between a and b: after the badge in the children, so it stays on top.
    expect(placeNew(col, snapshot, shape, { point: { x: 10, y: 150 } }, [])).toEqual({
      parentId: "root",
      index: 2,
    });
    expect(placeNew(col, snapshot, shape, { point: { x: 10, y: 900 } }, [])).toEqual({
      parentId: "root",
      index: 3,
    });
  });

  it("lands in a free frame centred on the point, kept inside, or exactly where drawn", () => {
    const shape = newLayer(item("rect"), ELEMENTS, null, false) as Node;
    expect(placeNew(index, frames, shape, { point: { x: 1360, y: 500 } }, [])).toEqual({
      parentId: "board",
      position: { x: 300, y: 200 }, // 1360-960-100, 500-200-100
    });
    // Near the corner (not in the "beside it" edge band): pulled back in.
    expect(placeNew(index, frames, shape, { point: { x: 1740, y: 780 } }, []).position).toEqual({
      x: 600,
      y: 400,
    });
    const drawn = newLayer(item("rect"), ELEMENTS, { w: 50, h: 30 }, true) as Node;
    expect(
      placeNew(
        index,
        frames,
        drawn,
        { point: { x: 1000, y: 300 }, rect: { x: 1000, y: 300, w: 50, h: 30 } },
        [],
      ),
    ).toEqual({ parentId: "board", position: { x: 40, y: 100 } });
  });

  it("without a point, goes where a paste would", () => {
    const shape = newLayer(item("rect"), ELEMENTS, null, false) as Node;
    expect(placeNew(index, frames, shape, null, [])).toEqual({ parentId: "root" });
    expect(placeNew(index, frames, shape, null, ["title"])).toEqual({ parentId: "root", index: 1 });
    // A selected free frame: into it, in its middle.
    expect(placeNew(index, frames, shape, null, ["board"])).toEqual({
      parentId: "board",
      position: { x: 300, y: 200 },
    });
    // Nothing measured: the paste rules alone.
    expect(placeNew(index, [], shape, { point: { x: 0, y: 0 } }, ["title"])).toEqual({
      parentId: "root",
      index: 1,
    });
  });

  it("skips locked frames", () => {
    const locked = frames.map((f) => (f.id === "board" ? { ...f, locked: true } : f));
    const shape = newLayer(item("rect"), ELEMENTS, null, false) as Node;
    expect(placeNew(index, locked, shape, { point: { x: 1360, y: 500 } }, []).parentId).toBe(
      "root",
    );
  });

  it("builds one node.insert, selected after, with text sized for a free frame", () => {
    const command = insertCommand(
      index,
      frames,
      item("text"),
      ELEMENTS,
      { point: { x: 1000, y: 260 } },
      [],
    );
    expect(command?.label).toBe("Add text");
    expect(command?.ops).toHaveLength(1);
    const op = insertOp(command?.ops ?? []);
    expect(op).toMatchObject({
      op: "node.insert",
      parentId: "board",
      node: { width: "hug", position: { x: 40, y: 60 } },
    });
    expect(op).not.toHaveProperty("index");
    expect(command?.select).toEqual([op.node.id]);

    const inFlow = insertCommand(
      index,
      frames,
      item("frame"),
      ELEMENTS,
      { point: { x: 400, y: 60 } },
      [],
    );
    expect(insertOp(inFlow?.ops ?? [])).toMatchObject({
      parentId: "root",
      index: 0,
      node: { kind: "frame" },
    });
    expect(insertOp(inFlow?.ops ?? []).node).not.toHaveProperty("position");
    expect(insertCommand(index, frames, item("image"), ELEMENTS, null, [])).toBeNull();
  });

  it("draws a box any direction; Shift squares it, Alt draws from the centre", () => {
    const none = { shift: false, alt: false };
    expect(drawnRect({ x: 100, y: 100 }, { x: 40, y: 160 }, none)).toEqual({
      x: 40,
      y: 100,
      w: 60,
      h: 60,
    });
    expect(drawnRect({ x: 0, y: 0 }, { x: 30, y: -10 }, { shift: true, alt: false })).toEqual({
      x: 0,
      y: -30,
      w: 30,
      h: 30,
    });
    expect(drawnRect({ x: 100, y: 100 }, { x: 110, y: 130 }, { shift: false, alt: true })).toEqual({
      x: 90,
      y: 70,
      w: 20,
      h: 60,
    });
    expect(drawnRect({ x: 0, y: 0 }, { x: 0, y: 5 }, { shift: true, alt: false })).toEqual({
      x: 0,
      y: 0,
      w: 5,
      h: 5,
    });
  });

  it("sections the Add menu: recent on top, then by section; a search shows matches", () => {
    const items = [
      { id: "add.text", label: "Text", section: "Basic" },
      { id: "add.rect", label: "Rectangle", section: "Shapes", keywords: "square" },
      { id: "add.frame", label: "Frame", section: "Basic" },
      { id: "add.chart", label: "Chart" },
    ];
    const titles = (q: string, recent: string[] = []) =>
      menuSections(items, q, recent).map(
        (s) => `${s.title}: ${s.items.map((i) => i.label).join(", ")}`,
      );
    expect(titles("")).toEqual(["Basic: Text, Frame", "Shapes: Rectangle", "More: Chart"]);
    expect(titles("", ["add.rect", "gone"])).toEqual([
      "Recent: Rectangle",
      "Basic: Text, Frame",
      "Shapes: Rectangle",
      "More: Chart",
    ]);
    expect(titles("squ", ["add.rect"])).toEqual(["Results: Rectangle"]);
    expect(titles("zzz")).toEqual([]);
  });
});
