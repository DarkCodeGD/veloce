import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  slideLayouts as slideLayoutsOf,
  walkNodes,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  componentPreviewDeck,
  insertComponentCommand,
  LAYOUT_PREVIEW_ID,
  layoutPreviewDeck,
  newSlideFromLayoutCommand,
  proposeParams,
  removeComponentCommand,
  saveComponentCommand,
} from "./components.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, content: string, extra = {}) =>
  element("text", { content }, { id, ...extra });

/** root (stack) > [card (free, at 40,60) > [title "Title", body], board (absolute)] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({
            id: "card",
            width: 400,
            positioning: "free",
            position: { x: 40, y: 60 },
            children: [text("title", "Our plan", { name: "Card title" }), text("body", "Details")],
          }),
          frame({ id: "board", layout: { mode: "absolute" }, width: 800, height: 600 }),
        ],
      }),
    ],
  });
}

const indexOf = (deck: Deck) => indexSlide(deck.slides[0] as never);
const apply = (deck: Deck, command: Command | null) => {
  if (!command) throw new Error("no command");
  const result = applyTransaction(deck, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return result.deck;
};
const card = (deck: Deck) => indexOf(deck).nodes.get("card")?.node as never;

/** The deck with the card saved as "Card", its two texts as params. */
function withCard(): Deck {
  const deck = makeDeck();
  const params = proposeParams(card(deck));
  return apply(deck, saveComponentCommand(deck, { name: "Card", node: card(deck), params }));
}

describe("saving a layer as a component (D94)", () => {
  it("offers each text as a param, named after its layer", () => {
    expect(proposeParams(card(makeDeck()))).toEqual([
      { param: "cardTitle", target: "title.props.content", label: "Card title" },
      { param: "text", target: "body.props.content", label: "Details" },
    ]);
    const twoUnnamed = frame({ children: [text("a", "A"), text("b", "B")] });
    expect(proposeParams(twoUnnamed).map((p) => p.param)).toEqual(["text", "text2"]);
  });

  it("saves it as one undoable op, without where it sat", () => {
    const deck = withCard();
    const saved = deck.components?.Card;
    expect(saved?.params).toEqual({
      cardTitle: { targets: ["title.props.content"] },
      text: { targets: ["body.props.content"] },
    });
    expect(saved?.node).not.toHaveProperty("position");
    expect(saved?.node).not.toHaveProperty("positioning");
    expect(saved?.node).toMatchObject({ id: "card", width: 400 });
    // Saving under the same name again says so.
    expect(saveComponentCommand(deck, { name: "Card", node: card(deck), params: [] }).label).toBe(
      'Replace component "Card"',
    );
    expect("components" in apply(deck, removeComponentCommand("Card"))).toBe(false);
  });
});

describe("inserting a component", () => {
  it("adds a plain copy with fresh IDs, at the end with nothing selected, and selects it", () => {
    const deck = withCard();
    const command = insertComponentCommand(deck, indexOf(deck), [], "Card", []);
    expect(command?.label).toBe('Insert "Card"');
    const next = apply(deck, command);
    const root = next.slides[0]?.root;
    const copy = root?.children[2];
    expect(copy?.id).toBe(command?.select?.[0]);
    expect([...walkNodes(copy as never)].map(({ node }) => node.id)).toEqual([
      copy?.id,
      `${copy?.id}-title`,
      `${copy?.id}-body`,
    ]);
    expect(copy).toMatchObject({
      width: 400,
      children: [{ props: { content: "Our plan" } }, { props: { content: "Details" } }],
    });
  });

  it("goes into a selected free frame at a position", () => {
    const deck = withCard();
    const frames = [
      {
        id: "board",
        flow: "absolute" as const,
        rect: { x: 100, y: 100, w: 800, h: 600 },
        children: [],
      },
    ];
    const command = insertComponentCommand(deck, indexOf(deck), frames as never, "Card", ["board"]);
    const op = command?.ops[0];
    expect(op).toMatchObject({ op: "node.insert", parentId: "board" });
    expect(op?.op === "node.insert" && op.node.position).toEqual({ x: 200, y: 300 });
  });

  it("returns nothing for a component that's gone", () => {
    expect(insertComponentCommand(makeDeck(), indexOf(makeDeck()), [], "Nope", [])).toBeNull();
  });
});

describe("a component's preview", () => {
  it("draws the template alone, at the deck's stage size", () => {
    const deck = withCard();
    const component = deck.components?.Card;
    if (!component) throw new Error("no component");
    const preview = componentPreviewDeck(deck, component);
    expect(preview.slides).toHaveLength(1);
    expect(preview.slides[0]?.root.children[0]).toBe(component.node);
    expect(preview.stage).toEqual(deck.stage);
  });
});

describe("slide layouts (D95)", () => {
  it("saves the slide on screen as a layout, and starts new slides from it", () => {
    const deck = makeDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("no slide");
    const save = saveComponentCommand(deck, {
      name: "Plan",
      node: slide.root,
      params: [{ param: "title", target: "title.props.content" }],
      slide: { background: "$color.surface" },
    });
    expect(save.label).toBe('Save slide layout "Plan"');
    const saved = apply(deck, save);
    expect(saved.components?.Plan?.slide).toEqual({ background: "$color.surface" });

    const add = newSlideFromLayoutCommand(saved, "Plan", 0);
    const next = apply(saved, add);
    const made = next.slides[1];
    expect(made?.id).toBe(add?.select?.[0]);
    expect(made?.background).toBe("$color.surface");
    expect(indexSlide(made as never).nodes.get(`${made?.id}-title`)?.node).toMatchObject({
      props: { content: "Our plan" },
    });
    // A layout isn't a layer component.
    expect(insertComponentCommand(saved, indexOf(saved), [], "Plan", [])).toBeNull();
  });

  it("starts slides from the built-in ones, and previews them in the deck's theme", () => {
    const deck = makeDeck();
    const add = newSlideFromLayoutCommand(deck, "Quote", 0);
    expect(add?.label).toBe('New slide from "Quote"');
    expect(apply(deck, add).slides).toHaveLength(2);
    const layout = slideLayoutsOf(deck).find((l) => l.name === "Quote")?.component;
    if (!layout) throw new Error("no layout");
    const preview = layoutPreviewDeck(deck, "Quote", layout);
    expect(preview.slides.map((s) => s.id)).toEqual([LAYOUT_PREVIEW_ID]);
    expect(preview.theme).toBe(deck.theme);
    expect(newSlideFromLayoutCommand(deck, "Nope", 0)).toBeNull();
  });

  it("asks for a section's name after a Section header, and previews it with one (D97)", () => {
    const deck = makeDeck();
    expect(newSlideFromLayoutCommand(deck, "Section header", 0)?.nameSection).toBe(true);
    expect(newSlideFromLayoutCommand(deck, "Quote", 0)?.nameSection).toBe(false);
    const layout = slideLayoutsOf(deck).find((l) => l.name === "Section header")?.component;
    if (!layout) throw new Error("no layout");
    expect(layoutPreviewDeck(deck, "Section header", layout).slides[0]?.section).toBe("Section");
  });
});
