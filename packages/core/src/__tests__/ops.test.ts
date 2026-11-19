import { describe, expect, it } from "vitest";
import { createSlide, element, frame } from "../builders.js";
import type { ApplyContext } from "../checks.js";
import { VeloceError } from "../errors.js";
import { deepEqual } from "../json.js";
import { applyOp } from "../ops/apply.js";
import type { Op } from "../ops/schema.js";
import type { Deck } from "../schema/deck.js";
import { MAX_DEPTH, type Node } from "../schema/node.js";
import { findNode } from "../tree.js";
import { deepFreeze, fixtureDeck, IMAGE_ID } from "./fixtures.js";

/** Apply an op, then its inverse, and check we're back where we started. */
function roundTrip(deck: Deck, op: Op, ctx?: ApplyContext): Deck {
  const { deck: next, inverse } = applyOp(deck, op, ctx);
  const { deck: restored } = applyOp(deepFreeze(next), inverse, ctx);
  expect(deepEqual(restored, deck)).toBe(true);
  return next;
}

function failure(deck: Deck, op: Op, ctx?: ApplyContext): VeloceError {
  try {
    applyOp(deck, op, ctx);
  } catch (error) {
    if (error instanceof VeloceError) return error;
    throw error;
  }
  throw new Error(`expected ${op.op} to fail`);
}

const image = { mime: "image/png", bytes: 3, name: "logo.png", width: 1, height: 1 };

describe("ops: apply + exact inverse", () => {
  const deck = fixtureDeck();

  it("slide.insert / slide.remove / slide.move", () => {
    const next = roundTrip(deck, {
      op: "slide.insert",
      slide: createSlide({ id: "mid" }),
      index: 1,
    });
    expect(next.slides.map((s) => s.id)).toEqual(["intro", "mid", "outro"]);
    expect(roundTrip(deck, { op: "slide.remove", id: "intro" }).slides.map((s) => s.id)).toEqual([
      "outro",
    ]);
    expect(
      roundTrip(deck, { op: "slide.move", id: "intro", index: 1 }).slides.map((s) => s.id),
    ).toEqual(["outro", "intro"]);
  });

  it("slide.update patches fields and keeps the tree", () => {
    const next = roundTrip(deck, {
      op: "slide.update",
      id: "intro",
      set: { name: "Intro", notes: "Say hi", background: "$color.surface" },
    });
    expect(next.slides[0]).toMatchObject({
      name: "Intro",
      notes: "Say hi",
      background: "$color.surface",
    });
    expect(next.slides[0]?.root).toBe(deck.slides[0]?.root);
  });

  it("node.insert / node.remove", () => {
    const sub = element("text", { content: "Sub" }, { id: "subtitle" });
    const next = roundTrip(deck, {
      op: "node.insert",
      parentId: "intro-root",
      node: sub,
      index: 1,
    });
    expect(next.slides[0]?.root.children.map((n) => n.id)).toEqual(["title", "subtitle", "cards"]);
    roundTrip(deck, { op: "node.remove", id: "cards" });
  });

  it("node.move within a frame, across frames and across slides", () => {
    const within = roundTrip(deck, {
      op: "node.move",
      id: "cards",
      parentId: "intro-root",
      index: 0,
    });
    expect(within.slides[0]?.root.children.map((n) => n.id)).toEqual(["cards", "title"]);
    const across = roundTrip(deck, { op: "node.move", id: "title", parentId: "card-1" });
    expect(findNode(across, "title")?.parent?.id).toBe("card-1");
    const otherSlide = roundTrip(deck, { op: "node.move", id: "box", parentId: "cards", index: 0 });
    expect(findNode(otherSlide, "box")?.slide.id).toBe("intro");
  });

  it("node.update merges fields and props, and its inverse only reverts what it changed", () => {
    const next = roundTrip(deck, {
      op: "node.update",
      id: "title",
      set: { opacity: 0.5, name: null, props: { color: "$color.primary" } },
    });
    expect(findNode(next, "title")?.node).toMatchObject({
      opacity: 0.5,
      props: { content: "Hello", color: "$color.primary" },
    });
    expect(findNode(next, "title")?.node.name).toBeUndefined();
  });

  it("node.update can switch a frame's layout variant in one patch", () => {
    const next = roundTrip(deck, {
      op: "node.update",
      id: "cards",
      set: { layout: { mode: "stack", direction: "row", gap: "$space.md" } },
    });
    expect(findNode(next, "cards")?.node).toMatchObject({
      layout: { mode: "stack", direction: "row", gap: "$space.md" },
    });
  });

  it("node.update can switch a frame's padding to another form, and undo restores it", () => {
    const { deck: axes } = applyOp(deck, {
      op: "node.update",
      id: "cards",
      set: { layout: { padding: { x: 10, y: 20 } } },
    });
    const next = roundTrip(axes, {
      op: "node.update",
      id: "cards",
      set: { layout: { padding: { top: 1, right: 2, bottom: 3, left: 4 } } },
    });
    expect(findNode(next, "cards")?.node).toMatchObject({
      layout: { padding: { top: 1, right: 2, bottom: 3, left: 4 } },
    });
  });

  it("deck.updateMeta / deck.setTheme", () => {
    roundTrip(deck, { op: "deck.updateMeta", set: { title: "Renamed", authors: ["Ada"] } });
    roundTrip(deck, { op: "deck.setTheme", theme: { ...deck.theme, name: "Dark" } });
  });

  it("asset.add / asset.remove, and asset.add is idempotent", () => {
    const withAsset = roundTrip(deck, { op: "asset.add", id: IMAGE_ID, asset: image });
    const again = applyOp(withAsset, { op: "asset.add", id: IMAGE_ID, asset: image });
    expect(again.deck).toBe(withAsset);
    expect(applyOp(again.deck, again.inverse).deck.assets[IMAGE_ID]).toEqual(image);
    roundTrip(withAsset, { op: "asset.remove", id: IMAGE_ID });
  });

  it("shares every untouched subtree with the previous version", () => {
    const { deck: next } = applyOp(deck, {
      op: "node.update",
      id: "card-1-text",
      set: { opacity: 0.2 },
    });
    expect(next.slides[1]).toBe(deck.slides[1]); // other slide untouched
    expect(next.slides[0]?.root.children[0]).toBe(deck.slides[0]?.root.children[0]); // sibling untouched
    expect(next.theme).toBe(deck.theme);
  });
});

describe("ops: helpful failures", () => {
  const deck = fixtureDeck();

  it("suggests the nearest ID on typos", () => {
    const err = failure(deck, { op: "node.update", id: "titel", set: { opacity: 1 } });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.hint).toBe('Did you mean "title"?');
  });

  it("explains slide/node ID mix-ups", () => {
    expect(failure(deck, { op: "node.remove", id: "intro" }).hint).toBe(
      '"intro" is a slide. Its root frame is "intro-root".',
    );
    expect(failure(deck, { op: "slide.remove", id: "title" }).hint).toBe(
      '"title" is a node on slide "intro", not a slide.',
    );
  });

  it("refuses to insert into an element", () => {
    const err = failure(deck, { op: "node.insert", parentId: "title", node: element("text", {}) });
    expect(err.code).toBe("FORBIDDEN");
    expect(err.hint).toMatch(/"intro-root"/);
  });

  it("refuses to remove or move a slide's root, or move a node into its own subtree", () => {
    expect(failure(deck, { op: "node.remove", id: "intro-root" }).code).toBe("FORBIDDEN");
    expect(failure(deck, { op: "node.move", id: "intro-root", parentId: "cards" }).code).toBe(
      "FORBIDDEN",
    );
    expect(failure(deck, { op: "node.move", id: "cards", parentId: "card-1" }).message).toMatch(
      /into itself/,
    );
  });

  it("rejects duplicate IDs across the whole deck, including inside the inserted subtree", () => {
    const dupe = failure(deck, {
      op: "node.insert",
      parentId: "cards",
      node: element("text", {}, { id: "box" }),
    });
    expect(dupe.code).toBe("CONFLICT");
    const nested = frame({
      id: "n1",
      children: [element("text", {}, { id: "n2" }), element("text", {}, { id: "n2" })],
    });
    expect(failure(deck, { op: "node.insert", parentId: "cards", node: nested }).code).toBe(
      "CONFLICT",
    );
    expect(failure(deck, { op: "slide.insert", slide: createSlide({ id: "title" }) }).code).toBe(
      "CONFLICT",
    );
  });

  it("rejects out-of-range indexes with a hint", () => {
    const err = failure(deck, { op: "slide.move", id: "intro", index: 5 });
    expect(err.message).toBe("Index 5 is out of range for the deck's slides (0–1)");
  });

  it("protects identity fields from updates", () => {
    expect(failure(deck, { op: "node.update", id: "title", set: { type: "shape" } }).path).toBe(
      "set.type",
    );
    expect(failure(deck, { op: "node.update", id: "cards", set: { children: [] } }).code).toBe(
      "FORBIDDEN",
    );
    expect(failure(deck, { op: "slide.update", id: "intro", set: { root: null } }).code).toBe(
      "FORBIDDEN",
    );
  });

  it("validates the patched result against the schema", () => {
    const err = failure(deck, { op: "node.update", id: "title", set: { opacity: 2 } });
    expect(err.code).toBe("INVALID");
    expect(err.path).toBe("set.opacity");
  });

  it("explains how to write padding when a patch mixes its forms", () => {
    const err = failure(deck, {
      op: "node.update",
      id: "cards",
      set: { layout: { padding: { x: 10, top: 4 } } },
    });
    expect(err.path).toBe("set.layout.padding");
    expect(err.message).toMatch(/\{ x, y \}, or \{ top, right, bottom, left \}/);
    // A bad value inside a valid form still points at that value.
    const value = failure(deck, {
      op: "node.update",
      id: "cards",
      set: { layout: { padding: { left: -5 } } },
    });
    expect(value.message).toMatch(/set\.layout\.padding\.left: Too small/);
  });

  it("requires assets to be registered and refuses to remove assets in use", () => {
    const img = element("image", { asset: `asset:${IMAGE_ID}` }, { id: "img" });
    const missing = failure(deck, { op: "node.insert", parentId: "intro-root", node: img });
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.hint).toMatch(/asset\.add/);

    let next = applyOp(deck, { op: "asset.add", id: IMAGE_ID, asset: image }).deck;
    next = applyOp(next, { op: "node.insert", parentId: "intro-root", node: img }).deck;
    const inUse = failure(next, { op: "asset.remove", id: IMAGE_ID });
    expect(inUse.code).toBe("FORBIDDEN");
    expect(inUse.message).toMatch(/"img"/);
  });

  it("enforces the maximum nesting depth", () => {
    let node: Node = element("text", {});
    for (let i = 0; i < MAX_DEPTH; i++) node = frame({ children: [node] });
    expect(failure(deck, { op: "node.insert", parentId: "intro-root", node }).code).toBe(
      "FORBIDDEN",
    );
  });

  it("asks the plugin registry to validate element props", () => {
    const ctx: ApplyContext = {
      validateElement: (type, props) =>
        type !== "text"
          ? { ok: false, reason: "unknown-type", message: `Unknown element type "${type}"` }
          : typeof props.content === "string"
            ? { ok: true }
            : { ok: false, reason: "invalid-props", message: "content: Expected string" },
    };
    const bad = failure(
      deck,
      { op: "node.update", id: "title", set: { props: { content: 5 } } },
      ctx,
    );
    expect(bad.message).toBe('Element "title" (text): content: Expected string');
    const unknown = failure(
      deck,
      { op: "node.insert", parentId: "cards", node: element("sparkles", {}) },
      ctx,
    );
    expect(unknown.code).toBe("NOT_FOUND");
  });
});
