/**
 * Phase 1 acceptance test (docs/ROADMAP.md): build a deck purely through transactions, with an
 * agent and a human editing side by side, save it as .veloce, load it back identically, and
 * check that undo is tracked per origin.
 */
import {
  assetRef,
  createDeck,
  createSlide,
  DeckDocument,
  deepEqual,
  element,
  findNode,
  frame,
  sha256Hex,
  type TransactionInput,
} from "@veloce/core";
import { readVeloce, writeVeloce } from "@veloce/format";
import { PluginRegistry } from "@veloce/plugin-api";
import { imagePlugin } from "@veloce/plugin-image";
import { shapePlugin } from "@veloce/plugin-shape";
import { textPlugin } from "@veloce/plugin-text";
import { describe, expect, it } from "vitest";

const AGENT = "agent:claude" as const;
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);

function registry(): PluginRegistry {
  return new PluginRegistry().register(textPlugin).register(shapePlugin).register(imagePlugin);
}

const card = (n: number, title: string, body: string) =>
  frame({
    id: `card-${n}`,
    layout: { mode: "stack", gap: "$space.sm", padding: "$space.md" },
    style: { fill: "$color.surface", radius: "$radius.md", shadow: "$shadow.sm" },
    children: [
      element("text", { content: title, style: "$text.h3" }, { id: `card-${n}-title` }),
      element("text", { content: body, color: "$color.muted" }, { id: `card-${n}-body` }),
    ],
  });

describe("Phase 1: transactions → .veloce → back, with per-origin undo", () => {
  it("round-trips an agent-built, human-edited deck", async () => {
    const plugins = registry();
    const logoId = await sha256Hex(LOGO);
    const doc = new DeckDocument(createDeck({ id: "pitch", title: "Veloce Pitch" }), {
      context: plugins.applyContext(),
    });

    // 1. The agent builds two slides in ONE transaction (one undo step).
    const build: TransactionInput = {
      origin: AGENT,
      label: "Create pitch deck",
      ops: [
        {
          op: "asset.add",
          id: logoId,
          asset: { mime: "image/png", bytes: LOGO.length, name: "logo.png" },
        },
        {
          op: "slide.insert",
          slide: createSlide({
            id: "title-slide",
            rootId: "title-root",
            background: {
              type: "linear-gradient",
              angle: 135,
              stops: [
                { offset: 0, color: "$color.primary" },
                { offset: 1, color: "$color.secondary" },
              ],
            },
            children: [
              element(
                "image",
                { asset: assetRef(logoId), alt: "Veloce logo", fit: "contain" },
                { id: "logo", width: 160, height: 160 },
              ),
              element(
                "text",
                {
                  content: "Presentations, at the speed of thought",
                  style: "$text.display",
                  color: "$color.on-primary",
                },
                { id: "headline" },
              ),
            ],
          }),
        },
        {
          op: "slide.insert",
          slide: createSlide({
            id: "features",
            rootId: "features-root",
            children: [
              element(
                "text",
                { content: "Why Veloce", style: "$text.h1" },
                { id: "features-title" },
              ),
              frame({
                id: "cards",
                layout: { mode: "grid", columns: 3, gap: "$space.md" },
                children: [
                  card(1, "AI-first", "Agents and humans share one engine."),
                  card(2, "Animated", "One deterministic timeline."),
                  card(3, "Open", "Apache-2.0, plugins welcome."),
                ],
              }),
            ],
          }),
        },
      ],
    };
    expect(doc.apply(build).ok).toBe(true);

    // 2. The human tweaks the headline while the agent keeps working.
    expect(
      doc.apply({
        origin: "user",
        label: "Tone down headline",
        ops: [{ op: "node.update", id: "headline", set: { props: { style: "$text.h1" } } }],
      }).ok,
    ).toBe(true);
    expect(
      doc.apply({
        origin: AGENT,
        label: "Add speaker notes",
        ops: [{ op: "slide.update", id: "features", set: { notes: "Pause after each card." } }],
      }).ok,
    ).toBe(true);

    // 3. A plugin-invalid edit is rejected with an actionable message, deck unchanged.
    const before = doc.deck;
    const bad = doc.apply({
      origin: AGENT,
      label: "Oops",
      ops: [{ op: "node.update", id: "card-2-titel", set: { props: { style: "big" } } }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.hint).toBe('Did you mean "card-2-title"?');
    const badProps = doc.apply({
      origin: AGENT,
      label: "Oops",
      ops: [{ op: "node.update", id: "card-2-title", set: { props: { style: "big" } } }],
    });
    expect(badProps.ok).toBe(false);
    if (!badProps.ok)
      expect(badProps.error.message).toMatch(
        /props\.style: Expected a theme token like "\$text\.<name>"/,
      );
    expect(doc.deck).toBe(before);

    // 4. Per-origin undo: the human's undo leaves the agent's work alone.
    expect(doc.undo("user")?.ok).toBe(true);
    expect(findNode(doc.deck, "headline")?.node).toMatchObject({
      props: { style: "$text.display" },
    });
    expect(doc.deck.slides[1]?.notes).toBe("Pause after each card.");

    // 5. Save → load: identical deck, assets and plugin lock.
    const file = await writeVeloce(
      { deck: doc.deck, assets: new Map([[logoId, LOGO]]), plugins: plugins.lockFor(doc.deck) },
      { generator: { name: "veloce-tests", version: "0.0.0" } },
    );
    const loaded = await readVeloce(file, { context: plugins.applyContext() });
    expect(deepEqual(loaded.deck, doc.deck)).toBe(true);
    expect(loaded.assets.get(logoId)).toEqual(LOGO);
    expect(loaded.plugins).toEqual({ "veloce.text": "0.1.0", "veloce.image": "0.1.0" });
    expect(loaded.warnings).toEqual([]);

    // 6. The reopened deck keeps working, and "undo what the AI did" is one step on a live document.
    const reopened = new DeckDocument(loaded.deck, { context: plugins.applyContext() });
    expect(reopened.apply(build).ok).toBe(false); // IDs already exist → CONFLICT, nothing changes
    const live = new DeckDocument(createDeck({ title: "Scratch" }), {
      context: plugins.applyContext(),
    });
    live.apply(build);
    expect(live.deck.slides).toHaveLength(2);
    live.undo(AGENT);
    expect(live.deck.slides).toHaveLength(0);
    expect(live.deck.assets).toEqual({});
  });
});
