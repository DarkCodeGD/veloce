import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  lintDeck,
  morphPairs,
  type Node,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  copyNodes,
  cutNodes,
  missingAssets,
  parsePayload,
  pasteNodes,
  pasteSvg,
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

  it("keeps free layers free in stacks (stepping off taken spots), not in free frames", () => {
    const base = makeDeck();
    const badge = text("badge", "New", { positioning: "free", position: { x: 500, y: 10 } });
    const deck = apply(base, {
      label: "Add badge",
      ops: [{ op: "node.insert", parentId: "root", node: badge }],
    });
    const node = (d: Deck, id: string | undefined) => indexOf(d).nodes.get(id ?? "")?.node;

    // Pasted next to itself: still free, shifted off the original.
    const again = paste(deck, ["badge"]);
    expect(node(again.deck, again.command.select?.[0])).toMatchObject({
      positioning: "free",
      position: { x: 520, y: 30 },
    });
    // Into an absolute frame every child is free: the flag goes, the position stays.
    const payload = copyNodes(indexOf(deck), ["badge"]) ?? undefined;
    const intoFrame = paste(deck, ["a"], payload);
    const pasted = node(intoFrame.deck, intoFrame.command.select?.[0]);
    expect(pasted?.positioning).toBeUndefined();
    expect(pasted?.position).toEqual({ x: 500, y: 10 });
  });

  it("steps anchored pastes down-right on screen, and keeps the anchor in free frames", () => {
    const base = makeDeck();
    const pin = text("pin", "Hot", {
      positioning: "free",
      anchor: { x: "end" },
      position: { x: 16, y: 16 },
    });
    const deck = apply(base, {
      label: "Add pin",
      ops: [{ op: "node.insert", parentId: "root", node: pin }],
    });
    const node = (d: Deck, id: string | undefined) => indexOf(d).nodes.get(id ?? "")?.node;
    const again = paste(deck, ["pin"]);
    // Right-pinned: 20px further right on screen is 20px less from the right edge.
    expect(node(again.deck, again.command.select?.[0])).toMatchObject({
      anchor: { x: "end" },
      position: { x: -4, y: 36 },
    });
    const payload = copyNodes(indexOf(deck), ["pin"]) ?? undefined;
    const intoFrame = paste(deck, ["a"], payload);
    expect(node(intoFrame.deck, intoFrame.command.select?.[0])?.anchor).toEqual({ x: "end" });
    // Into a stack's flow (pasted after a flow layer): position and anchor both go.
    const flowCopy = copyNodes(indexOf(deck), ["pin"]);
    if (!flowCopy) throw new Error("no copy");
    const first = flowCopy.nodes[0];
    if (first) first.positioning = "auto";
    const inFlow = paste(deck, ["footer"], flowCopy);
    const flowNode = node(inFlow.deck, inFlow.command.select?.[0]);
    expect(flowNode?.position).toBeUndefined();
    expect(flowNode?.anchor).toBeUndefined();
  });

  it("keeps match keys when pasting onto another slide, not next to the original (D109)", () => {
    const deck = makeDeck();
    const payload = copyNodes(indexOf(deck), ["card", "footer"]);
    if (!payload) throw new Error("nothing copied");
    // Same slide: the originals hold the keys, so the copies don't take them.
    const here = paste(deck, ["footer"], payload).deck;
    const copies = here.slides[0]?.root.children.slice(3) ?? [];
    expect(copies.map((c) => c.matchKey)).toEqual([undefined, undefined]);

    // Another slide: a logo pasted onto the next slide morphs with the one it came from.
    const other = createSlide({ id: "s2", rootId: "root2", children: [text("x", "X")] });
    const two = { ...deck, slides: [...deck.slides, other] };
    const index = indexSlide(other);
    const result = pasteNodes(index, payload, [], noAssets);
    if (!result.ok) throw new Error(result.message);
    const after = apply(two, result.command);
    const pairs = morphPairs(after.slides[0] as never, after.slides[1] as never);
    expect(pairs.map((p) => p.from.id)).toEqual(["card", "title", "body", "footer"]);

    // Pasting the same layers there again: the keys are taken now, so the second copies
    // have none, and the slide never ends up with a key twice.
    const again = pasteNodes(indexSlide(after.slides[1] as never), payload, [], noAssets);
    if (!again.ok) throw new Error(again.message);
    const twice = apply(after, again.command);
    expect(lintDeck(twice).filter((i) => i.rule === "duplicate-match-key")).toEqual([]);
  });

  it("cuts as one undoable removal", () => {
    const deck = makeDeck();
    const command = cutNodes(indexOf(deck), ["title", "footer"]);
    expect(command?.label).toBe("Cut 2 layers");
    const next = apply(deck, command);
    expect(childIds(next, "card")).toEqual(["body"]);
    expect(cutNodes(indexOf(deck), [])).toBeNull();
  });

  it("carries images between decks: the files go along and register with the paste", () => {
    const id = "a".repeat(64);
    const info = { mime: "image/png", bytes: 3, width: 2, height: 2, name: "a.png" };
    const image: Node = element("image", { asset: `asset:${id}`, alt: "" }, { id: "img" });
    const source: Deck = {
      ...createDeck({
        title: "src",
        slides: [createSlide({ id: "s1", rootId: "root", children: [image] })],
      }),
      assets: { [id]: info, ["b".repeat(64)]: { mime: "image/png", bytes: 1 } },
    };
    const payload = copyNodes(indexOf(source), ["img"], {
      deckId: "deck_src",
      assets: source.assets,
    });
    // Only the files the copied layers use travel, and they survive the clipboard round trip.
    expect(payload?.source).toEqual({ deckId: "deck_src", assets: { [id]: info } });
    const parsed = parsePayload(serializePayload(payload as never));
    expect(parsed?.source).toEqual(payload?.source);
    if (!parsed) throw new Error("no payload");

    const target = makeDeck();
    expect(missingAssets(parsed, noAssets)).toEqual({
      missing: [id],
      copyable: [id],
      fromDeck: "deck_src",
    });
    // Without the files copied over, the paste is refused (nothing half-pasted).
    const refused = pasteNodes(indexOf(target), parsed, [], noAssets);
    expect(refused).toEqual({
      ok: false,
      message: expect.stringContaining("aren't available here"),
    });
    // With them: asset.add and the layer in one transaction.
    const result = pasteNodes(indexOf(target), parsed, [], noAssets, [{ id, info }]);
    if (!result.ok) throw new Error(result.message);
    expect(result.command.ops.map((o) => o.op)).toEqual(["asset.add", "node.insert"]);
    const after = apply(target, result.command);
    expect(after.assets[id]).toEqual(info);
    // Pasting again: the deck has the file now, so no second asset.add.
    const again = pasteNodes(indexOf(after), parsed, [], new Set(Object.keys(after.assets)));
    expect(again.ok && again.command.ops.map((o) => o.op)).toEqual(["node.insert"]);
  });

  it("ignores a malformed source in clipboard data from elsewhere", () => {
    const text = JSON.stringify({
      veloce: 1,
      nodes: [element("text", { content: "x" })],
      source: { deckId: "../../etc", assets: { nothex: { mime: "image/png", bytes: 1 } } },
    });
    expect(parsePayload(text)?.source).toBeUndefined();
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

  it("pastes SVG from other apps as vector layers, an icon scaled up to be seen (D127)", () => {
    const deck = makeDeck();
    const icon =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/><script>alert(1)</script></svg>';
    const result = pasteSvg(indexOf(deck), ["title"], icon, deck.stage);
    if (!result.ok) throw new Error(result.message);
    expect(result.leftOut).toEqual(["<script>: scripts never run in a deck"]);
    const next = apply(deck, result.command);
    const node = indexOf(next).nodes.get(result.command.select?.[0] ?? "")?.node;
    expect(node).toMatchObject({ type: "vector", width: 160, height: 160 });
    expect(node?.kind === "element" && node.props.stroke).toEqual({
      color: "$color.text",
      width: 13.33, // 2 units, scaled with the icon
    });
    expect(childIds(next, "card")).toEqual(["title", node?.id, "body"]);

    // A huge one fits the slide; a broken one says why.
    const poster = pasteSvg(
      indexOf(deck),
      [],
      '<svg viewBox="0 0 5000 1000"><rect width="5000" height="1000"/></svg>',
      deck.stage,
    );
    expect(poster.ok && poster.command.ops[0]).toMatchObject({
      node: { width: 1536, height: 307.2 },
    });
    const broken = pasteSvg(indexOf(deck), [], "<svg><g></svg>", deck.stage);
    expect(broken.ok).toBe(false);
  });
});
