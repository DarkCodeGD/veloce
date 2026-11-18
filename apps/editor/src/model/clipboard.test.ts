import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  type Node,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  copyNodes,
  cutNodes,
  parsePayload,
  pasteNodes,
  pasteTarget,
  pasteText,
  plainTextOf,
  serializePayload,
} from "./clipboard.js";
import type { Command } from "./commands.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, content: string, extra = {}) =>
  element("text", { content }, { id, ...extra });

/** root (stack) > [card > [title, body], free (absolute) > [a @10,20], footer] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({ id: "card", children: [text("title", "Hello"), text("body", "World")] }),
          frame({
            id: "free",
            layout: { mode: "absolute" },
            children: [text("a", "A", { position: { x: 10, y: 20 } })],
          }),
          text("footer", "Footer"),
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
const childIds = (deck: Deck, id: string) => {
  const node = indexOf(deck).nodes.get(id)?.node;
  return node?.kind === "frame" ? node.children.map((c) => c.id) : [];
};
const noAssets = new Set<string>();

function paste(deck: Deck, selection: string[], payload = copyNodes(indexOf(deck), selection)) {
  if (!payload) throw new Error("nothing copied");
  const result = pasteNodes(indexOf(deck), payload, selection, noAssets);
  if (!result.ok) throw new Error(result.message);
  return { deck: apply(deck, result.command), command: result.command };
}

describe("clipboard", () => {
  it("copies the selection's top-level layers in document order, deep-copied", () => {
    const index = indexOf(makeDeck());
    const payload = copyNodes(index, ["footer", "title", "card", "root"]);
    expect(payload?.nodes.map((n) => n.id)).toEqual(["card", "footer"]); // title is in card
    expect(copyNodes(index, [])).toBeNull();
    expect(plainTextOf(payload?.nodes ?? [])).toBe("Hello\nWorld\nFooter");
  });

  it("round-trips through clipboard text, rejecting anything that isn't ours", () => {
    const payload = copyNodes(indexOf(makeDeck()), ["card"]);
    if (!payload) throw new Error("nothing copied");
    expect(parsePayload(serializePayload(payload))).toEqual(payload);
    expect(parsePayload("hello")).toBeNull();
    expect(parsePayload('{"veloce":1,"nodes":[{"kind":"bogus"}]}')).toBeNull();
    expect(parsePayload('{"veloce":2,"nodes":[]}')).toBeNull();
  });

  it("pastes after the copied layer with fresh IDs (or inside a selected other frame)", () => {
    const deck = makeDeck();
    const index = indexOf(deck);
    expect(pasteTarget(index, ["card"], new Set(["card"]))).toEqual({ parentId: "root", index: 1 });
    expect(pasteTarget(index, ["card"], new Set(["footer"]))).toEqual({ parentId: "card" });
    expect(pasteTarget(index, [], new Set())).toEqual({ parentId: "root" });

    const { deck: next, command } = paste(deck, ["card"]);
    expect(command.label).toBe('Paste "Frame"');
    const ids = childIds(next, "root");
    expect(ids[0]).toBe("card");
    expect(ids[1]).toBe(command.select?.[0]);
    expect(ids[1]).not.toBe("card");
    // The copy's children have fresh IDs too.
    expect(childIds(next, ids[1] as string)).not.toContain("title");
  });

  it("shifts pastes in a free frame while the position is taken, drops it in stacks", () => {
    const deck = makeDeck();
    const once = paste(deck, ["a"]);
    const twice = paste(once.deck, ["a"], copyNodes(indexOf(deck), ["a"]) ?? undefined);
    const positions = childIds(twice.deck, "free").map(
      (id) => indexOf(twice.deck).nodes.get(id)?.node.position,
    );
    expect(positions).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 60 }, // the second paste lands right after "a", so it's second
      { x: 30, y: 40 },
    ]);
    // Into a stack: no position.
    const payload = copyNodes(indexOf(deck), ["a"]);
    const inStack = paste(deck, ["footer"], payload ?? undefined);
    const pasted = indexOf(inStack.deck).nodes.get(inStack.command.select?.[0] ?? "")?.node;
    expect(pasted?.position).toBeUndefined();
  });

  it("cuts as one undoable removal", () => {
    const deck = makeDeck();
    const command = cutNodes(indexOf(deck), ["title", "footer"]);
    expect(command?.label).toBe("Cut 2 layers");
    const next = apply(deck, command);
    expect(childIds(next, "card")).toEqual(["body"]);
    expect(cutNodes(indexOf(deck), [])).toBeNull();
  });

  it("refuses layers whose images this deck doesn't have", () => {
    const image: Node = element("image", { src: `asset:${"a".repeat(64)}` }, { id: "img" });
    const result = pasteNodes(indexOf(makeDeck()), { veloce: 1, nodes: [image] }, [], noAssets);
    expect(result.ok).toBe(false);
  });

  it("pastes text from other apps as a text layer", () => {
    const deck = makeDeck();
    const command = pasteText(indexOf(deck), ["title"], "  Line one\r\nLine two  ");
    const next = apply(deck, command);
    const node = indexOf(next).nodes.get(command?.select?.[0] ?? "")?.node;
    expect(node?.kind === "element" && node.props.content).toBe("Line one\nLine two");
    expect(childIds(next, "card")).toEqual(["title", command?.select?.[0], "body"]);
    expect(pasteText(indexOf(deck), [], "   ")).toBeNull();
  });
});
