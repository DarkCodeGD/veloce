import { describe, expect, it } from "vitest";
import { element } from "../builders.js";
import { DeckDocument } from "../document.js";
import { deepEqual } from "../json.js";
import { applyTransaction } from "../transaction.js";
import { findNode } from "../tree.js";
import { fixtureDeck } from "./fixtures.js";

const opacityOf = (doc: DeckDocument, id: string) => findNode(doc.deck, id)?.node.opacity;

describe("applyTransaction", () => {
  it("is atomic: a failing op leaves the deck untouched and points at the culprit", () => {
    const deck = fixtureDeck();
    const result = applyTransaction(deck, {
      origin: "agent:claude",
      label: "Broken batch",
      ops: [
        { op: "node.update", id: "title", set: { opacity: 0.5 } },
        { op: "node.remove", id: "nope" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: "NOT_FOUND",
      opIndex: 1,
      op: "node.remove",
      path: "ops[1]",
    });
    expect(result.error.message).toBe('ops[1] (node.remove): Node "nope" not found');
  });

  it("validates the envelope and every op before applying anything", () => {
    const result = applyTransaction(fixtureDeck(), {
      origin: "robot",
      label: "x",
      ops: [{ op: "node.update", id: "title", set: {} }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^origin: Origin must be/);

    const badOp = applyTransaction(fixtureDeck(), {
      origin: "user",
      label: "x",
      ops: [
        { op: "node.insert", parentId: "cards", node: { id: "x", kind: "element", type: "text" } },
      ],
    });
    expect(badOp.ok).toBe(false);
    if (!badOp.ok) expect(badOp.error).toMatchObject({ opIndex: 0, path: "ops[0].node.props" });
  });

  it("returns an inverse that undoes the whole batch", () => {
    const deck = fixtureDeck();
    const result = applyTransaction(deck, {
      origin: "user",
      label: "Batch",
      ops: [
        {
          op: "node.insert",
          parentId: "cards",
          node: element("text", { content: "B" }, { id: "b" }),
        },
        { op: "node.move", id: "b", parentId: "intro-root", index: 0 },
        { op: "node.update", id: "b", set: { opacity: 0.3 } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.id).toMatch(/^tx_/);
    const undone = applyTransaction(result.deck, {
      origin: "user",
      label: "Undo",
      ops: result.inverse,
    });
    expect(undone.ok && deepEqual(undone.deck, deck)).toBe(true);
  });
});

describe("DeckDocument: per-origin undo/redo", () => {
  const update = (origin: string, id: string, opacity: number) => ({
    origin,
    label: `Fade ${id}`,
    ops: [{ op: "node.update", id, set: { opacity } }],
  });

  it("a user's undo never reverts the agent's work (and vice versa)", () => {
    const doc = new DeckDocument(fixtureDeck());
    doc.apply(update("user", "title", 0.5));
    doc.apply(update("agent:claude", "box", 0.25));

    expect(doc.undo("user")?.ok).toBe(true);
    expect(opacityOf(doc, "title")).toBeUndefined();
    expect(opacityOf(doc, "box")).toBe(0.25);

    expect(doc.undo("agent:claude")?.ok).toBe(true);
    expect(opacityOf(doc, "box")).toBeUndefined();
    expect(doc.undo("user")).toBeNull();
    expect(doc.version).toBe(4);
  });

  it("undo only reverts the fields it changed, keeping others' edits to the same node", () => {
    const doc = new DeckDocument(fixtureDeck());
    doc.apply(update("user", "title", 0.5));
    doc.apply({
      origin: "agent:claude",
      label: "Rename",
      ops: [{ op: "node.update", id: "title", set: { name: "Headline" } }],
    });
    doc.undo("user");
    expect(findNode(doc.deck, "title")?.node).toMatchObject({ name: "Headline" });
    expect(opacityOf(doc, "title")).toBeUndefined();
  });

  it("redo replays an undone step; a new change clears redo for that origin only", () => {
    const doc = new DeckDocument(fixtureDeck());
    doc.apply(update("user", "title", 0.5));
    doc.apply(update("agent:claude", "box", 0.25));
    doc.undo("user");
    doc.undo("agent:claude");
    expect(doc.redo("user")?.ok).toBe(true);
    expect(opacityOf(doc, "title")).toBe(0.5);

    doc.apply(update("user", "title", 0.9));
    expect(doc.canRedo("user")).toBe(false);
    expect(doc.canRedo("agent:claude")).toBe(true);
  });

  it("says which transaction an undo or redo takes back, through any number of round trips", () => {
    const doc = new DeckDocument(fixtureDeck());
    const applied = doc.apply(update("user", "title", 0.5));
    if (!applied.ok) throw new Error("apply failed");
    expect(applied.reverses).toBeUndefined();

    const undone = doc.undo("user");
    expect(undone?.ok && undone.reverses).toBe(applied.transaction.id);
    const redone = doc.redo("user");
    // A redo takes back the undo (not the original change).
    expect(redone?.ok && redone.reverses).toBe(undone?.ok && undone.transaction.id);
    const again = doc.undo("user");
    expect(again?.ok && again.reverses).toBe(redone?.ok && redone.transaction.id);
  });

  it("fails cleanly when someone else's change makes an undo impossible", () => {
    const doc = new DeckDocument(fixtureDeck());
    doc.apply(update("user", "title", 0.5));
    doc.apply({
      origin: "agent:claude",
      label: "Delete title",
      ops: [{ op: "node.remove", id: "title" }],
    });
    const result = doc.undo("user");
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error.message).toMatch(/^Can't undo "Fade title": /);
    expect(doc.canUndo("user")).toBe(false); // dropped, not stuck
  });

  it("caps history per origin and can skip recording", () => {
    const doc = new DeckDocument(fixtureDeck(), { historyLimit: 2 });
    for (const o of [0.1, 0.2, 0.3]) doc.apply(update("user", "title", o));
    expect(doc.undoLabels("user")).toHaveLength(2);
    doc.apply(update("system", "box", 0.5), { recordHistory: false });
    expect(doc.canUndo("system")).toBe(false);
  });

  it("knows which assets an undo or redo could add back (their bytes must be kept)", () => {
    const [a, b] = ["a".repeat(64), "b".repeat(64)];
    const info = { mime: "image/png", bytes: 3, name: "x.png", width: 1, height: 1 };
    const add = (origin: "user" | "agent:x", id: string) => ({
      origin,
      label: "Add",
      ops: [{ op: "asset.add", id, asset: info }],
    });
    const remove = (origin: "user" | "agent:x", id: string) => ({
      origin,
      label: "Remove",
      ops: [{ op: "asset.remove", id }],
    });
    const doc = new DeckDocument(fixtureDeck(), { historyLimit: 1 });
    expect(doc.restorableAssetIds()).toEqual(new Set());
    doc.apply(add("user", a)); // undo would remove it: nothing to restore
    expect(doc.restorableAssetIds()).toEqual(new Set());
    doc.apply(remove("user", a)); // undo adds it back
    expect(doc.restorableAssetIds()).toEqual(new Set([a]));
    doc.undo("user"); // back in the deck; redo would remove it again
    expect(doc.restorableAssetIds()).toEqual(new Set());
    doc.apply(add("agent:x", b));
    doc.undo("agent:x"); // another origin's redo would add b
    expect(doc.restorableAssetIds()).toEqual(new Set([b]));
    // A new change clears that origin's redo: b is no longer held.
    doc.apply(remove("agent:x", a));
    expect(doc.restorableAssetIds()).toEqual(new Set([a]));
    // A step that falls off the history limit (1 here) stops holding its asset.
    doc.apply(remove("user", a)); // nothing to remove: fails, the history is unchanged
    doc.apply({
      origin: "agent:x",
      label: "Rename",
      ops: [{ op: "deck.updateMeta", set: { title: "t" } }],
    });
    expect(doc.restorableAssetIds()).toEqual(new Set());
  });

  it("returns errors without changing the document", () => {
    const doc = new DeckDocument(fixtureDeck());
    const before = doc.deck;
    expect(doc.apply(update("user", "ghost", 1)).ok).toBe(false);
    expect(doc.deck).toBe(before);
    expect(doc.version).toBe(0);
  });
});
