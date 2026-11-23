import { describe, expect, it } from "vitest";
import { assetUsage } from "../assets.js";
import { element, frame } from "../builders.js";
import type { ElementValidator } from "../checks.js";
import { componentProblem, instantiateComponent } from "../components.js";
import type { Op } from "../ops/schema.js";
import { type Component, ComponentNameSchema } from "../schema/component.js";
import type { Deck } from "../schema/deck.js";
import { applyTransaction } from "../transaction.js";
import { walkNodes } from "../tree.js";
import { validateDeck } from "../validate.js";
import { restoreOps } from "../versions.js";
import { deepFreeze, fixtureDeck, IMAGE_ID } from "./fixtures.js";

/** A card: a frame with a title and a body, and params for both texts and the fill. */
const CARD: Component = deepFreeze({
  description: "A feature card",
  params: {
    title: { targets: ["card-title.props.content"] },
    body: { description: "One line", targets: ["card-body.props.content"] },
    color: { targets: ["card.style.fill"] },
  },
  node: frame({
    id: "card",
    layout: { mode: "stack", gap: 8 },
    style: { fill: "$color.surface" },
    children: [
      element("text", { content: "Title" }, { id: "card-title" }),
      element("text", { content: "Body" }, { id: "card-body" }),
    ],
  }),
});

function apply(deck: Deck, ...ops: Op[]) {
  const result = applyTransaction(deck, { origin: "user", label: "Test", ops });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function applyError(deck: Deck, ...ops: Op[]) {
  const result = applyTransaction(deck, { origin: "user", label: "Test", ops });
  if (result.ok) throw new Error("expected the transaction to fail");
  return result.error;
}

const ids = (node: { id: string }) =>
  [...walkNodes(node as never)].map(({ node: n }) => (n as { id: string }).id);

describe("component names", () => {
  it("are words joined by single separators, in any script", () => {
    for (const ok of ["Card", "Feature card", "kpi-tile", "level_2", "Équipe", "カード"]) {
      expect(ComponentNameSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["", " card", "card ", "a  b", "card!", "__proto__", "a".repeat(61)]) {
      expect(ComponentNameSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("saving and removing components (D94)", () => {
  it("saves one as an undoable op, and removing it is undoable too", () => {
    const deck = fixtureDeck();
    const saved = apply(deck, { op: "component.save", name: "Card", component: CARD });
    expect(saved.deck.components?.Card).toEqual(CARD);
    expect(saved.inverse).toEqual([{ op: "component.remove", name: "Card" }]);

    const removed = apply(saved.deck, { op: "component.remove", name: "Card" });
    // The last one gone: the field goes too.
    expect("components" in removed.deck).toBe(false);
    const back = apply(removed.deck, ...removed.inverse);
    expect(back.deck.components?.Card).toEqual(CARD);
  });

  it("replacing one gives back the old one on undo", () => {
    const deck = apply(fixtureDeck(), { op: "component.save", name: "Card", component: CARD }).deck;
    const plain: Component = { node: element("text", { content: "Hi" }, { id: "t" }) };
    const replaced = apply(deck, { op: "component.save", name: "Card", component: plain });
    expect(replaced.inverse).toEqual([{ op: "component.save", name: "Card", component: CARD }]);
  });

  it("refuses a name that only differs in case, and says which one exists", () => {
    const deck = apply(fixtureDeck(), { op: "component.save", name: "Card", component: CARD }).deck;
    const error = applyError(deck, { op: "component.save", name: "card", component: CARD });
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain('"Card"');
  });

  it("suggests the nearest name when removing one that isn't there", () => {
    const deck = apply(fixtureDeck(), { op: "component.save", name: "Card", component: CARD }).deck;
    const error = applyError(deck, { op: "component.remove", name: "Crad" });
    expect(error.code).toBe("NOT_FOUND");
    expect(error.hint).toContain('"Card"');
  });

  it("checks params against the template", () => {
    const target = (t: string): Component => ({
      ...CARD,
      params: { x: { targets: [t] } },
    });
    expect(componentProblem(target("nope.props.content"))?.message).toContain('"nope"');
    expect(componentProblem(target("card-title.id"))?.code).toBe("FORBIDDEN");
    expect(componentProblem(target("card-title.children"))?.code).toBe("FORBIDDEN");
    expect(componentProblem(target("card-title.style.fill"))?.hint).toContain("props");
    expect(componentProblem(target("card.props.content"))?.hint).toContain("style");
    expect(componentProblem(target("card.constructor.prototype"))?.code).toBe("FORBIDDEN");
    expect(componentProblem(CARD)).toBeNull();
  });

  it("refuses a template with a repeated ID", () => {
    const twice: Component = {
      node: frame({
        id: "a",
        children: [
          element("text", { content: "1" }, { id: "b" }),
          element("text", {}, { id: "b" }),
        ],
      }),
    };
    expect(
      applyError(fixtureDeck(), { op: "component.save", name: "X", component: twice }).code,
    ).toBe("CONFLICT");
  });

  it("counts a component's image as a use: the asset can't be removed under it", () => {
    const withImage: Component = {
      node: element("image", { src: `asset:${IMAGE_ID}` }, { id: "pic" }),
    };
    const deck = apply(
      { ...fixtureDeck(), assets: { [IMAGE_ID]: { mime: "image/png", bytes: 3 } } },
      { op: "component.save", name: "Logo", component: withImage },
    ).deck;
    expect(assetUsage(deck).get(IMAGE_ID)).toEqual(["component:Logo"]);
    expect(applyError(deck, { op: "asset.remove", id: IMAGE_ID }).code).toBe("FORBIDDEN");
    // …and it has to exist to be saved.
    const missing = applyError(fixtureDeck(), {
      op: "component.save",
      name: "Logo",
      component: withImage,
    });
    expect(missing.code).toBe("NOT_FOUND");
  });

  it("validates components in a whole deck, and restores them with a version", () => {
    const deck = apply(fixtureDeck(), { op: "component.save", name: "Card", component: CARD }).deck;
    expect(validateDeck(deck).ok).toBe(true);
    const broken = {
      ...deck,
      components: { Card: { ...CARD, params: { x: { targets: ["nope.props.content"] } } } },
    };
    const result = validateDeck(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe("components.Card");

    // A version without the component, restored over a deck with it (and back).
    const without = fixtureDeck();
    const restored = apply(deck, ...restoreOps(deck, without));
    expect(restored.deck.components).toBeUndefined();
    expect(apply(without, ...restoreOps(without, deck)).deck.components).toEqual({ Card: CARD });
  });
});

describe("inserting a copy", () => {
  it("is a plain node with readable fresh IDs, the params written in", () => {
    const copy = instantiateComponent("Card", CARD, {
      id: "c1",
      with: { title: "Faster", color: "$color.primary" },
    });
    expect(ids(copy)).toEqual(["c1", "c1-title", "c1-body"]);
    expect(copy).toMatchObject({
      kind: "frame",
      style: { fill: "$color.primary" },
      children: [{ props: { content: "Faster" } }, { props: { content: "Body" } }],
    });
    // The template is untouched (it's frozen: a write would have thrown).
    expect(CARD.node).toMatchObject({ style: { fill: "$color.surface" } });
  });

  it("avoids IDs in use, and records the ones it takes", () => {
    const taken = new Set(["c1-title"]);
    const copy = instantiateComponent("Card", CARD, { id: "c1", taken });
    const [, title, body] = ids(copy);
    expect(title).toMatch(/^nd_/);
    expect(body).toBe("c1-body");
    expect(taken).toEqual(new Set(["c1", "c1-title", "c1-body", title]));
    // Without an ID, the root gets a generated one and the rest follow it.
    const other = instantiateComponent("Card", CARD, { taken });
    expect(ids(other)[1]).toBe(`${other.id}-title`);
  });

  it("names an unknown param and suggests the right one", () => {
    expect(() => instantiateComponent("Card", CARD, { with: { titel: "x" }, at: "node" })).toThrow(
      expect.objectContaining({ path: "node.with.titel", hint: 'Did you mean "title"?' }),
    );
  });

  it("blames a value that doesn't fit on its param", () => {
    expect(() => instantiateComponent("Card", CARD, { with: { color: 42 } })).toThrow(
      expect.objectContaining({ path: "with.color", message: expect.stringContaining('"color"') }),
    );
    const validate: ElementValidator = (_type, props) =>
      typeof props.content === "string" && props.content.length > 5
        ? { ok: false, reason: "invalid-props", message: "content: too long" }
        : { ok: true };
    expect(() =>
      instantiateComponent("Card", CARD, {
        with: { body: "Much too long" },
        validateElement: validate,
      }),
    ).toThrow(expect.objectContaining({ path: "with.body" }));
  });

  it("removes a field for a null value", () => {
    const copy = instantiateComponent("Card", CARD, { with: { color: null } });
    expect(copy.kind === "frame" && copy.style).toEqual({});
  });
});
