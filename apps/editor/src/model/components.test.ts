import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  walkNodes,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  componentPreviewDeck,
  insertComponentCommand,
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
