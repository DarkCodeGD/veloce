import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  type Deck,
  type SlideMeasurement,
  TextContentSchema,
  toPlainText,
  walkNodes,
} from "@veloce/core";
import { type ImageOptimizer, type RenderService, Workspace } from "@veloce/doc-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "./docs.js";
import { agentOrigin, VeloceMcp } from "./server.js";
import { TOOLS, toolInputSchema } from "./tools.js";

/** Pretends to lay slides out: text longer than 80 chars "overflows" its box. */
const fakeRender: RenderService = {
  async measure(deck: Deck, { slideIds }) {
    return deck.slides
      .filter((s) => !slideIds || slideIds.includes(s.id))
      .map((slide): SlideMeasurement => {
        const nodes: SlideMeasurement["nodes"] = {};
        for (const { node } of walkNodes(slide.root)) {
          const content =
            node.kind === "element" ? TextContentSchema.safeParse(node.props.content) : null;
          const long = content?.success && toPlainText(content.data).length > 80;
          const y = 100 + Object.keys(nodes).length * 110; // stacked: no overlaps
          nodes[node.id] = {
            bounds: { x: 100, y, width: 800, height: 100 },
            ...(long && { overflow: { x: 0, y: 64 } }),
          };
        }
        return { slideId: slide.id, stage: deck.stage, nodes };
      });
  },
  async screenshot() {
    return { data: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
  },
  async close() {},
};

let dir: string;
let workspace: Workspace;
let client: Client;

/** A 1×1 lossless WebP: what the stand-in optimizer "makes" (the real one has its own tests). */
const TINY_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

/** Stands in for the image optimizer (D67): every photo becomes TINY_WEBP. */
const fakeOptimizer: ImageOptimizer = async (_bytes, size) => ({
  optimized: {
    bytes: new Uint8Array(TINY_WEBP),
    mime: "image/webp",
    width: 1,
    height: 1,
    method: "webp",
    quality: 82,
    ...(size.width && size.width > 3840 && { resizedFrom: { width: size.width, height: 1 } }),
  },
});

async function connect(render: RenderService | null = fakeRender) {
  workspace = await Workspace.open({
    dir,
    context: createBuiltinRegistry().applyContext(),
    autosaveDelayMs: 5,
    optimizer: fakeOptimizer,
  });
  const mcp = new VeloceMcp({
    workspace,
    registry: createBuiltinRegistry(),
    render,
    renderUnavailable: "Chromium isn't installed",
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.createServer().connect(serverSide);
  client = new Client({ name: "Claude Code", version: "1.0.0" });
  await client.connect(clientSide);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string; mimeType?: string }>;
  return {
    isError: result.isError === true,
    text: content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
    content,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-mcp-"));
});
afterEach(async () => {
  await client?.close();
  await workspace?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("tool listing", () => {
  it("lists the tools with JSON Schemas small enough to keep in an agent's context", async () => {
    await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
    const size = (name: string) => {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      return JSON.stringify(toolInputSchema(tool)).length;
    };
    expect(size("apply_ops")).toBeLessThan(1000);
    expect(size("upsert_slide")).toBeLessThan(16_000);
    expect(size("save_component")).toBeLessThan(1500);
    const instructions = client.getInstructions();
    expect(instructions).toMatch(/upsert_slide/);
  });

  it("derives the agent origin from the client name", () => {
    expect(agentOrigin("Claude Code")).toBe("agent:claude-code");
    expect(agentOrigin(undefined)).toBe("agent:unknown");
  });
});

describe("building a deck", () => {
  it("creates a deck, builds slides, reports lint, edits by ID and undoes only its own work", async () => {
    await connect();
    expect((await call("get_deck_summary")).text).toMatch(/No deck is open[\s\S]*create_deck/);

    const created = await call("create_deck", { title: "Acme Pitch", theme: "midnight" });
    expect(created.text).toMatch(/Created deck "Acme Pitch"/);
    expect(created.text).toMatch(/theme Midnight/);

    const upsert = await call("upsert_slide", {
      slide: {
        id: "intro",
        name: "Title",
        children: [
          { id: "headline", type: "text", props: { content: "Acme", style: "$text.display" } },
          { id: "tagline", type: "text", props: { content: "x".repeat(120), style: "$text.h3" } },
          {
            layout: { mode: "stack", direction: "row", gap: "$space.md" },
            children: [{ type: "shape", props: { shape: "ellipse" } }],
          },
        ],
      },
    });
    expect(upsert.isError).toBe(false);
    expect(upsert.text).toMatch(/Add slide "Title": done/);
    expect(upsert.text).toMatch(/- headline: text "Acme" \$text\.display/);
    expect(upsert.text).toMatch(/\[error\] overflow · slide intro · tagline/);

    // Fix it via apply_ops by ID; the lint for the changed slide comes back clean.
    const fixed = await call("apply_ops", {
      label: "Shorten tagline",
      ops: [
        { op: "node.update", id: "tagline", set: { props: { content: "Rockets for everyone" } } },
        {
          op: "node.insert",
          parentId: (await workspace.get(workspace.activeDeckId ?? "")).deck.slides[0]?.root.id,
          node: { id: "foot", type: "text", props: { content: "2026" } },
        },
      ],
    });
    expect(fixed.text).toMatch(/Applied "Shorten tagline" \(2 ops\)\. New node IDs: foot\./);
    expect(fixed.text).toMatch(/Lint: no issues/);

    // The user edits too; the agent's undo leaves the user's change alone.
    const deck = await workspace.get(workspace.activeDeckId ?? "");
    deck.apply({
      origin: "user",
      label: "User edit",
      ops: [{ op: "node.update", id: "headline", set: { props: { content: "ACME" } } }],
    });
    const undo = await call("undo_agent_changes");
    // The user's edit is reported first (D71); the undo itself left it alone.
    expect(undo.text).toMatch(
      /^Since your last call[\s\S]*"User edit"[\s\S]*\n\nUndid 1 step: "Shorten tagline"\. Changed: intro\.\n\nLint:/,
    );
    const summary = (await call("get_deck_summary")).text;
    expect(summary).toMatch(/headline: text "ACME"/);
    expect(summary).toContain("Footer: none.");
    expect(summary).not.toContain("no footer");

    // Morph match keys (D109): shown in the summary, and one per slide (lint says so).
    const keyed = await call("upsert_slide", {
      slide: {
        id: "keys",
        children: [
          { id: "k1", type: "text", matchKey: "logo", props: { content: "A" } },
          { id: "k2", type: "text", matchKey: "logo", props: { content: "B" } },
        ],
      },
    });
    expect(keyed.text).toMatch(/- k1: text "A".* \[key "logo"\]/);
    expect(keyed.text).toMatch(/\[warning\] duplicate-match-key · slide keys · k1, k2/);
    const bad = await call("apply_ops", {
      label: "Key",
      ops: [{ op: "node.update", id: "k2", set: { matchKey: " logo" } }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/one line of text with no spaces at either end/);
    const unkeyed = await call("apply_ops", {
      label: "Unkey",
      ops: [{ op: "node.update", id: "k2", set: { matchKey: null } }],
    });
    expect(unkeyed.text).not.toMatch(/duplicate-match-key/);
    await call("apply_ops", { label: "Remove", ops: [{ op: "slide.remove", id: "keys" }] });

    // Transitions (D123): set on the slide, shown in summaries, errors that say how to fix.
    const arrives = await call("upsert_slide", {
      slide: { id: "moves", transition: { type: "push", direction: "up" }, children: [] },
    });
    expect(arrives.text).toContain("arrives: push");
    const wrong = await call("apply_ops", {
      label: "Fade",
      ops: [{ op: "slide.update", id: "moves", set: { transition: { type: "fade" } } }],
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('in a patch: "direction": null');
    const right = await call("apply_ops", {
      label: "Fade",
      ops: [
        {
          op: "slide.update",
          id: "moves",
          set: { transition: { type: "fade", direction: null } },
        },
      ],
    });
    expect(right.isError).toBeFalsy();
    expect((await call("get_docs", { topic: "morph" })).text).toContain("# Transitions");
    await call("apply_ops", { label: "Remove", ops: [{ op: "slide.remove", id: "moves" }] });

    // Rebuilding a slide keeps the animations of layers still on it (D110).
    await call("upsert_slide", {
      slide: {
        id: "anim",
        children: [
          { id: "stay", type: "text", props: { content: "Stays" } },
          { id: "goes", type: "text", props: { content: "Goes" } },
        ],
      },
    });
    (await workspace.get(workspace.activeDeckId ?? "")).apply({
      origin: "user",
      label: "Animate",
      ops: ["stay", "goes"].map((target) => ({
        op: "animation.insert" as const,
        slideId: "anim",
        animation: { id: `an-${target}`, target, effect: { name: "fade-in" } },
      })),
    });
    const rebuilt = await call("upsert_slide", {
      overwrite: true,
      slide: { id: "anim", children: [{ id: "stay", type: "text", props: { content: "New" } }] },
    });
    expect(rebuilt.text).toMatch(
      /done\. \(kept 1 animation of layers still on it; removed 1 animation whose layers are gone\)/,
    );
    const anim = (await workspace.get(workspace.activeDeckId ?? "")).deck.slides.find(
      (s) => s.id === "anim",
    );
    expect(anim?.animations?.map((a) => a.id)).toEqual(["an-stay"]);
    await call("apply_ops", { label: "Remove", ops: [{ op: "slide.remove", id: "anim" }] });

    // Replacing a slide keeps its position.
    await call("upsert_slide", {
      slide: { id: "second", children: [{ type: "text", props: { content: "Two" } }] },
    });
    const replaced = await call("upsert_slide", {
      slide: { id: "intro", children: [{ type: "text", props: { content: "New intro" } }] },
    });
    expect(replaced.text).toMatch(/Replace slide intro: done[\s\S]*1\. slide intro/);
  });

  it("shows where everything sits on a Free slide (one made by hand, D83)", async () => {
    await connect();
    await call("create_deck", { title: "Canvas" });
    const upsert = await call("upsert_slide", {
      slide: {
        id: "hand",
        layout: { mode: "absolute" },
        children: [
          { id: "title", type: "text", props: { content: "Hi" }, position: { x: 120, y: 80 } },
          {
            id: "list",
            layout: { mode: "stack" },
            position: { x: 120, y: 300 },
            children: [{ id: "item", type: "text", props: { content: "One" } }],
          },
        ],
      },
    });
    expect(upsert.isError).toBe(false);
    expect(upsert.text).toMatch(/slide hand · root frame \S+ \(absolute\)/);
    expect(upsert.text).toMatch(/- title: text "Hi" \[at 120,80\]/);
    expect(upsert.text).toMatch(/- list: frame \(stack column\) \[at 120,300\]/);
    // In the list's flow: no position to show.
    expect(upsert.text).toMatch(/- item: text "One"$/m);
    const layoutDocs = (await call("get_docs", { topic: "layout" })).text;
    expect(layoutDocs).toMatch(/## Slides people made[\s\S]*Don't switch the root/);
  });

  it("places free layers on top of a stack, and flags positions a stack ignores", async () => {
    await connect();
    await call("create_deck", { title: "Badges" });
    const upsert = await call("upsert_slide", {
      slide: {
        id: "card",
        children: [
          { id: "title", type: "text", props: { content: "Pricing" } },
          {
            id: "badge",
            type: "text",
            props: { content: "New" },
            positioning: "free",
            position: { x: 1500, y: 40 },
          },
          {
            id: "pin",
            type: "text",
            props: { content: "Hot" },
            width: "hug",
            positioning: "free",
            anchor: { x: "end" },
            position: { x: 16, y: 16 },
            rotation: -4,
          },
          { id: "stray", type: "text", props: { content: "Oops" }, position: { x: 10, y: 10 } },
        ],
      },
    });
    expect(upsert.isError).toBe(false);
    expect(upsert.text).toMatch(/- badge: text "New" \[free at 1500,40\]/);
    expect(upsert.text).toMatch(
      /- pin: text "Hot" \[free at 16,16 from top-right\] \[rotated -4°\]/,
    );
    expect(upsert.text).toMatch(/ignored-position · slide card · stray/);
    expect(upsert.text).toMatch(/add positioning: "free"/);
    expect(upsert.text).not.toMatch(/ignored-position · slide card · badge/);
    const layoutDocs = (await call("get_docs", { topic: "layout" })).text;
    expect(layoutDocs).toMatch(/## Free layers/);
    // Gaps an agent hit (feedback round 2): rotation, inside strokes, the root's centring.
    expect(layoutDocs).toMatch(/## Rotation[\s\S]*upright box/);
    expect(layoutDocs).toMatch(/Strokes are drawn inside the frame's edge/);
    expect(layoutDocs).toMatch(/centered top-to-bottom.*"align": "center"/);
  });

  it("never silently overwrites a slide the user edited, and keeps the slide's root ID", async () => {
    await connect();
    await call("create_deck", { title: "Shared" });
    await call("upsert_slide", {
      slide: { id: "s1", children: [{ id: "t", type: "text", props: { content: "v1" } }] },
    });
    const open = await workspace.get(workspace.activeDeckId ?? "");
    const rootId = open.deck.slides[0]?.root.id;

    // The agent may replace its own slide; the root frame keeps its ID.
    await call("upsert_slide", {
      slide: { id: "s1", children: [{ id: "t", type: "text", props: { content: "v2" } }] },
    });
    expect(open.deck.slides[0]?.root.id).toBe(rootId);

    // Once the user edits it, a replace is refused with a way forward.
    open.apply({
      origin: "user",
      label: "User tweak",
      ops: [{ op: "node.update", id: "t", set: { props: { content: "mine" } } }],
    });
    const refused = await call("upsert_slide", {
      slide: { id: "s1", children: [{ type: "text", props: { content: "v3" } }] },
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/last edited by the user[\s\S]*How to fix: .*apply_ops/);
    expect(open.deck.slides[0]?.root.children[0]).toMatchObject({ props: { content: "mine" } });

    // A new session (e.g. after a server restart) can't rebuild the earlier session's slides.
    await client.close();
    await workspace.close();
    await connect();
    const later = await call("upsert_slide", {
      slide: { id: "s1", children: [{ type: "text", props: { content: "v3" } }] },
    });
    expect(later.text).toMatch(/existed before this session/);
    // It can still add new slides, and rebuild those.
    await call("upsert_slide", {
      slide: { id: "s2", children: [{ type: "text", props: { content: "a" } }] },
    });
    const own = await call("upsert_slide", {
      slide: { id: "s2", children: [{ type: "text", props: { content: "b" } }] },
    });
    expect(own.isError).toBe(false);

    // Explicit overwrite (the user asked for a redo) still works.
    const forced = await call("upsert_slide", {
      overwrite: true,
      slide: { id: "s1", children: [{ type: "text", props: { content: "v3" } }] },
    });
    expect(forced.isError).toBe(false);
  });

  it("returns actionable errors", async () => {
    await connect();
    await call("create_deck", { title: "Errors" });
    await call("upsert_slide", {
      slide: { id: "s1", children: [{ id: "title", type: "text", props: { content: "Hi" } }] },
    });

    const typo = await call("apply_ops", {
      label: "x",
      ops: [{ op: "node.update", id: "titel", set: { hidden: true } }],
    });
    expect(typo.isError).toBe(true);
    expect(typo.text).toMatch(/How to fix: Did you mean "title"\?/);

    const badProps = await call("upsert_slide", {
      slide: { children: [{ type: "text", props: { content: "Hi", style: "text.h1" } }] },
    });
    expect(badProps.isError).toBe(true);
    expect(badProps.text).toMatch(/props\.style/);
    // In the terms the agent sent: no generated ID, no internal op, a path into its slide.
    expect(badProps.text).toMatch(/^Error: The text element: props\.style/);
    expect(badProps.text).toMatch(/At: slide\.children\[0\]\.props$/m);
    expect(badProps.text).not.toMatch(/nd_|slide\.insert|ops\[/);

    // A shorthand node.insert (no kind, no id) reports its real mistake, not core's "kind/id
    // missing" from the strict node schema (D70).
    const rootOf = async (slideId: string) =>
      (await workspace.get(workspace.activeDeckId ?? "")).deck.slides.find((x) => x.id === slideId)
        ?.root.id;
    const anchor = { type: "text", positioning: "free", anchor: { x: "right" } };
    for (const node of [anchor, { ...anchor, kind: "element" }]) {
      const insert = await call("apply_ops", {
        label: "x",
        ops: [{ op: "node.insert", parentId: (await rootOf("s1")) ?? "", node }],
      });
      expect(insert.text).toMatch(/node\.anchor\.x: .*\(for "right", use "end"\)/);
      expect(insert.text).not.toMatch(/node\.(kind|id)/);
    }
    const nested = await call("apply_ops", {
      label: "x",
      ops: [
        {
          op: "node.insert",
          parentId: (await rootOf("s1")) ?? "",
          node: { children: [{ type: "text", props: { content: 1 } }] },
        },
      ],
    });
    expect(nested.text).toMatch(
      /^Error: ops\[0\] \(node\.insert\): The text element: props\.content/,
    );
    expect(nested.text).toMatch(/At: ops\[0\]\.node\.children\[0\]\.props$/m);

    // A well-formed but undefined token is accepted, and lint flags it with a suggestion.
    const unknownToken = await call("upsert_slide", {
      slide: {
        children: [{ id: "big", type: "text", props: { content: "Hi", style: "$text.h11" } }],
      },
    });
    expect(unknownToken.text).toMatch(
      /\[error\] unknown-token · slide \S+ · big: .*"\$text\.h11".* Fix: Did you mean "\$text\.h1"\?/,
    );

    const unknownType = await call("upsert_slide", {
      slide: { children: [{ type: "txt", props: {} }] },
    });
    expect(unknownType.text).toMatch(/Did you mean "text"\?/);

    const badShape = await call("upsert_slide", { slide: { children: [{ props: {} }] } });
    expect(badShape.isError).toBe(true);
    expect(badShape.text).toMatch(/How to fix: Nodes are/);

    expect((await call("get_slide", { slideId: "s2" })).text).toMatch(/Did you mean "s1"\?/);
    expect((await call("set_theme", { theme: "neon" })).text).toMatch(
      /Built-in themes: light, dark, midnight, ember/,
    );
    expect((await call("get_docs", { topic: "layuot" })).text).toMatch(/Did you mean "layout"\?/);
    expect((await call("no_such_tool")).text).toMatch(/Unknown tool/);
  });
});

describe("themes, docs, previews and decks", () => {
  it("adds images and fonts from files or base64, as one undoable transaction", async () => {
    await connect();
    await call("create_deck", { title: "Assets" });
    const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), 8, 0, 4, 0, 0, 0]);
    const path = join(dir, "dot.gif");
    await writeFile(path, gif);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"/>';
    const added = await call("add_asset", {
      files: [
        { path },
        { data: Buffer.from(svg).toString("base64"), name: "logo.svg" },
        { path }, // the same file twice is one asset
      ],
    });
    expect(added.isError).toBe(false);
    expect(added.text).toMatch(/dot\.gif: "asset:[0-9a-f]{64}" \(image\/gif, 8×4\)/);
    expect(added.text).toMatch(/logo\.svg: "asset:[0-9a-f]{64}" \(image\/svg\+xml, 20×10\)/);
    const deck = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    expect(Object.values(deck.assets).map((a) => a.name)).toEqual(
      expect.arrayContaining(["dot.gif", "logo.svg"]),
    );
    expect(Object.keys(deck.assets)).toHaveLength(2);
    // One transaction: one undo takes both back.
    await call("undo_agent_changes", { steps: 1 });
    expect((await workspace.get(workspace.activeDeckId ?? "")).deck.assets).toEqual({});

    // A font: its family goes into the theme docs, with a ready-to-use font stack.
    const emptyTtf = Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const font = await call("add_asset", {
      files: [{ data: emptyTtf, name: "Brand Sans-Bold.ttf" }],
    });
    expect(font.text).toMatch(/font family "Brand Sans"/);
    const docs = await call("get_docs", { topic: "theme" });
    expect(docs.text).toContain(
      'This deck\'s own fonts (added with add_asset): Brand Sans (`"Brand Sans", system-ui, sans-serif`)',
    );

    // Errors say how to fix the call.
    const relative = await call("add_asset", { files: [{ path: "dot.gif" }] });
    expect(relative.isError).toBe(true);
    expect(relative.text).toMatch(/isn't an absolute path[\s\S]*How to fix: Give the full path/);
    const notes = join(dir, "notes.txt");
    await writeFile(notes, "secret notes");
    const junk = await call("add_asset", { files: [{ path: notes }] });
    expect(junk.text).toMatch(/notes\.txt: Unsupported file type[\s\S]*At: files\[0\]/);
  });

  it("reports how much smaller a big photo was made, and keeps exact files when asked", async () => {
    await connect();
    await call("create_deck", { title: "Photos" });
    // A PNG header (5000×2000) padded to 200 KB: big in bytes and in pixels.
    const png = new Uint8Array(200 * 1024);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 5000);
    new DataView(png.buffer).setUint32(20, 2000);
    const data = Buffer.from(png).toString("base64");
    const added = await call("add_asset", { files: [{ data, name: "hero.png" }] });
    expect(added.text).toMatch(
      /hero\.webp: "asset:[0-9a-f]{64}" \(image\/webp, 1×1; optimized from 205 KB PNG 5000×2000 to 34 bytes, looking the same\)/,
    );
    const exact = await call("add_asset", { files: [{ data, name: "hero.png", optimize: false }] });
    expect(exact.text).toMatch(/hero\.png: "asset:[0-9a-f]{64}" \(image\/png, 5000×2000\)/);
    const deck = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    expect(
      Object.values(deck.assets)
        .map((a) => a.mime)
        .sort(),
    ).toEqual(["image/png", "image/webp"]);
  });

  it("applies built-in themes and brand overrides", async () => {
    await connect();
    await call("create_deck", { title: "Brand" });
    const result = await call("set_theme", {
      theme: { base: "dark", colors: { primary: "#e11d48" } },
    });
    expect(result.text).toMatch(/Theme is now "Veloce Dark"/);
    const deck = await workspace.get(workspace.activeDeckId ?? "");
    expect(deck.deck.theme.colors.primary).toBe("#e11d48");
    expect(deck.deck.theme.colors.background).toBe("#0b0d12");
    const invalid = await call("set_theme", { theme: { colors: { primary: "red" } } });
    expect(invalid.text).toMatch(/How to fix: Colors are hex/);
  });

  it("serves docs generated from the registry and theme", async () => {
    await connect();
    expect((await call("get_docs", { topic: "element/text" })).text).toMatch(/^# text/);
    // Transcript regression: with no deck, theme docs must not pretend Light is current.
    const noDeck = (await call("get_docs", { topic: "theme" })).text;
    expect(noDeck).toMatch(/No deck is open/);
    expect(noDeck).toMatch(/`midnight`: Palette \(Midnight\).*\$color\.on-primary #0a1024/);
    const created = (await call("create_deck", { title: "Docs", theme: "midnight" })).text;
    expect(created).toMatch(/Palette \(Midnight\): background #0a1024/);
    const themed = (await call("get_docs", { topic: "theme" })).text;
    expect(themed).toMatch(/`\$color\.primary`: #8b6dff/);
    // Says whose theme it is (agents read it before create_deck and got the old deck's).
    expect(themed).toMatch(/theme of the open deck, "Docs"/);
    const types = (await call("list_element_types")).text;
    expect(types).toMatch(/## image: /);
    expect(types).not.toMatch(/\$schema/);
  });

  it("returns slide previews as images, or explains why it can't", async () => {
    await connect();
    await call("create_deck", { title: "Preview" });
    await call("upsert_slide", {
      slide: { id: "s1", children: [{ type: "text", props: { content: "Hi" } }] },
    });
    const preview = await call("render_preview", { slideId: "s1" });
    expect(preview.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    await client.close();
    await workspace.close();

    await connect(null);
    await call("open_deck", { deckId: workspace.list()[0]?.id });
    const unavailable = await call("render_preview", { slideId: "s1" });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.text).toMatch(/Chromium isn't installed/);
    expect((await call("lint")).text).toMatch(/Visual checks skipped: Chromium isn't installed/);
  });

  it("lists and switches decks, and exposes resources", async () => {
    await connect();
    await call("create_deck", { title: "One" });
    await call("create_deck", { title: "Two" });
    const list = (await call("list_decks")).text;
    expect(list).toMatch(/"Two" · 0 slides · two\.veloce · CURRENT · in the user's editor/);
    const one = workspace.list().find((d) => d.title === "One");
    await call("open_deck", { deckId: one?.id });
    expect(workspace.activeDeckId).toBe(one?.id);
    const resource = await client.readResource({ uri: "deck://current/summary" });
    expect(resource.contents[0]).toMatchObject({ text: expect.stringMatching(/^Deck "One"/) });
  });

  it("keeps each session on its own deck when the user or another agent switches (D68)", async () => {
    await connect();
    await call("create_deck", { title: "Mine" });
    const mine = workspace.activeDeckId ?? "";
    // The user opens another deck in the editor (the sync hub sets the active deck).
    const theirs = await workspace.create({ title: "Theirs" });
    expect(workspace.activeDeckId).toBe(theirs.id);
    const added = await call("upsert_slide", {
      slide: { id: "s1", children: [{ type: "text", props: { content: "Still mine" } }] },
    });
    expect(added.isError).toBe(false);
    expect((await workspace.get(mine)).deck.slides.map((s) => s.id)).toEqual(["s1"]);
    expect(theirs.deck.slides).toEqual([]);
    expect(workspace.activeDeckId).toBe(theirs.id); // agent writes don't yank the editor back
    const summary = (await call("get_deck_summary")).text;
    expect(summary).toMatch(/^Deck "Mine"/);
    expect(summary).toContain(`The user's editor is showing another deck right now.`);
    expect((await call("list_decks")).text).toMatch(
      /"Theirs" · 0 slides · theirs\.veloce · in the user's editor[\s\S]*"Mine" · 1 slides · mine\.veloce · CURRENT|"Mine" · 1 slides · mine\.veloce · CURRENT[\s\S]*"Theirs" · 0 slides · theirs\.veloce · in the user's editor/,
    );
    const resource = await client.readResource({ uri: "deck://current/summary" });
    expect(resource.contents[0]).toMatchObject({ text: expect.stringMatching(/^Deck "Mine"/) });

    // A second agent starts on the deck the editor shows, and pins its own.
    const second = new VeloceMcp({ workspace, registry: createBuiltinRegistry(), render: null });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await second.createServer().connect(serverSide);
    const other = new Client({ name: "Other agent", version: "1.0.0" });
    await other.connect(clientSide);
    const otherSummary = await other.callTool({ name: "get_deck_summary", arguments: {} });
    expect((otherSummary.content as Array<{ text: string }>)[0]?.text).toMatch(/^Deck "Theirs"/);
    await other.callTool({ name: "open_deck", arguments: { deckId: mine } });
    expect(workspace.activeDeckId).toBe(mine);
    await other.callTool({ name: "create_deck", arguments: { title: "Third" } });
    // …which doesn't move the first agent either.
    expect((await call("get_deck_summary")).text).toMatch(/^Deck "Mine"/);
    await other.close();
  });
});

describe("working alongside the user (D71)", () => {
  const text = (content: string) => ({ type: "text", props: { content } });

  it("shows agents the deck info the user set (D76): what it's about, who, which language", async () => {
    await connect();
    await call("create_deck", { title: "Pitch" });
    expect((await call("get_deck_summary")).text).not.toMatch(/About:|language/);
    const open = await workspace.get(workspace.activeDeckId ?? "");
    open.apply({
      origin: "user",
      label: "Edit deck info",
      ops: [
        {
          op: "deck.updateMeta",
          set: {
            description: "Seed round for investors",
            authors: ["Ada", "Alan"],
            language: "pt-BR",
          },
        },
      ],
    });
    const summary = (await call("get_deck_summary")).text;
    expect(summary).toMatch(
      /Deck "Pitch" [^\n]*\nAbout: Seed round for investors\nBy Ada, Alan · language pt-BR\n/,
    );
  });

  it("tells the agent what the user changed and reverted, once, and won't resurrect their removals", async () => {
    await connect();
    await call("create_deck", { title: "Shared" });
    await call("upsert_slide", { slide: { id: "s1", children: [{ id: "t", ...text("One") }] } });
    const added = await call("upsert_slide", { slide: { id: "s2", children: [text("Two")] } });
    // The agent's own changes are never reported back to it.
    expect(added.text).not.toMatch(/Since your last call/);
    const open = await workspace.get(workspace.activeDeckId ?? "");
    const addS2 = open.history.find((e) => e.label === "Add slide s2")?.version ?? 0;

    // The user tweaks s1 and reverts the agent's second slide from the History panel.
    open.apply({
      origin: "user",
      label: "Edit text",
      ops: [{ op: "node.update", id: "t", set: { props: { content: "Uno" } } }],
    });
    expect(open.revert([addS2], "user").ok).toBe(true);

    const next = await call("get_deck_summary");
    expect(next.content[0]?.text).toMatch(/^Since your last call, others changed this deck:/);
    expect(next.text).toContain('- The user: "Edit text"; changed slide s1.');
    expect(next.text).toContain(
      '- The user reverted your change "Add slide s2"; removed slide s2.',
    );
    expect(next.text).toMatch(/A revert is the user's decision: don't redo that work/);
    expect(next.text).toMatch(/get_slide before editing them/);
    // Said once: the next call has nothing new to report.
    expect((await call("get_deck_summary")).text).not.toMatch(/Since your last call/);

    // Rebuilding the reverted slide is refused, unless the user asked for it back.
    const again = await call("upsert_slide", { slide: { id: "s2", children: [text("Two")] } });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/Slide s2 was removed by the user[\s\S]*How to fix: Leave it out/);
    const asked = await call("upsert_slide", {
      overwrite: true,
      slide: { id: "s2", children: [text("Two")] },
    });
    expect(asked.isError).toBe(false);
  });

  it("reports changes on errors too, and an undone revert", async () => {
    await connect();
    await call("create_deck", { title: "Shared" });
    await call("upsert_slide", { slide: { id: "s1", children: [{ id: "t", ...text("One") }] } });
    const open = await workspace.get(workspace.activeDeckId ?? "");
    const version = open.version;
    expect(open.revert([version], "user").ok).toBe(true);
    expect(open.undo("user")?.ok).toBe(true);
    open.apply({ origin: "user", label: "Delete title", ops: [{ op: "node.remove", id: "t" }] });

    // The agent edits a node the user just deleted: the error comes with the why.
    const failed = await call("apply_ops", {
      label: "Fix title",
      ops: [{ op: "node.update", id: "t", set: { props: { content: "1" } } }],
    });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.text).toMatch(/^Since your last call/);
    // A revert undone right away is one line: nothing to act on (and no "decision" rule).
    expect(failed.text).toContain(
      '- The user reverted your change "Add slide s1", then undid that (no net change).',
    );
    expect(failed.text).not.toMatch(/decision/);
    expect(failed.text).toContain(
      '- The user: "Delete title"; changed slide s1; removed node t ("One").',
    );
    // The error says the user deleted it, with no "did you mean" pointing at other content;
    // a blank line separates it from the digest.
    expect(failed.text).toMatch(
      /get_slide before editing them\.\n\nError: Node "t" \("One"\) was deleted by the user \(it was on slide s1\)\.\nAt: ops\[0\]\nHow to fix: Don't recreate it/,
    );
    expect(failed.text).not.toMatch(/Did you mean/);

    // A slide the user removed, and nodes that went with it, say so too.
    await call("upsert_slide", { slide: { id: "s2", children: [{ id: "u", ...text("Two") }] } });
    open.apply({ origin: "user", label: "Delete slide", ops: [{ op: "slide.remove", id: "s2" }] });
    const onSlide = await call("apply_ops", {
      label: "Edit",
      ops: [{ op: "node.update", id: "u", set: { opacity: 0.5 } }],
    });
    expect(onSlide.text).toContain(
      'Error: Node "u" ("Two") was on slide s2, which the user removed.',
    );
    const slideOp = await call("apply_ops", {
      label: "Rename",
      ops: [{ op: "slide.update", id: "s2", set: { name: "x" } }],
    });
    expect(slideOp.text).toContain("Error: Slide s2 was removed by the user.");

    // undo_agent_changes says what it changed, with lint like the other edits.
    await call("upsert_slide", { slide: { id: "s3", children: [text("Three")] } });
    await call("apply_ops", {
      label: "Fade",
      ops: [{ op: "slide.update", id: "s3", set: { name: "Three" } }],
    });
    const undone = await call("undo_agent_changes");
    expect(undone.text).toMatch(/^Undid 1 step: "Fade"\. Changed: s3\.\n\n.*(lint|issue)/is);
  });
});

describe("components (D94)", () => {
  const CARD = {
    name: "Feature card",
    description: "Title and one line",
    node: {
      id: "card",
      layout: { mode: "stack", gap: "$space.sm" },
      style: { fill: "$color.surface" },
      children: [
        { id: "card-title", type: "text", props: { content: "Title", style: "$text.h3" } },
        { id: "card-body", type: "text", props: { content: "Body" } },
      ],
    },
    params: {
      title: "card-title.props.content",
      body: ["card-body.props.content"],
      accent: { description: "Card fill", targets: "card.style.fill" },
    },
  };

  it("saves a card once and inserts copies with use/with, as plain nodes", async () => {
    await connect();
    await call("create_deck", { title: "Reuse" });
    expect((await call("list_components")).text).toMatch(/No components yet/);

    const saved = await call("save_component", CARD);
    expect(saved.isError).toBe(false);
    expect(saved.text).toContain('Save component "Feature card": done');
    expect(saved.text).toContain("accent (Card fill) → card.style.fill");

    const slide = await call("upsert_slide", {
      slide: {
        id: "s1",
        layout: { mode: "grid", columns: 2 },
        children: [
          { use: "Feature card", id: "c1", with: { title: "Faster", accent: "$color.primary" } },
          { use: "Feature card", id: "c2", width: 300, with: { body: "Cheaper" } },
        ],
      },
    });
    expect(slide.isError).toBe(false);
    expect(slide.text).toContain('c1-title: text "Faster"');
    expect(slide.text).toContain('c2-body: text "Cheaper"');

    const open = await workspace.get(workspace.activeDeckId as string);
    const c1 = open.deck.slides[0]?.root.children[0];
    expect(c1).toMatchObject({ id: "c1", style: { fill: "$color.primary" } });
    expect(open.deck.slides[0]?.root.children[1]).toMatchObject({ id: "c2", width: 300 });
    // Copies are plain: nothing in the slide points at the component.
    expect(JSON.stringify(open.deck.slides)).not.toContain("use");

    // node.insert takes one too, and edits work by the derived IDs.
    const ops = await call("apply_ops", {
      label: "Third card",
      ops: [
        {
          op: "node.insert",
          parentId: open.deck.slides[0]?.root.id,
          node: { use: "Feature card", id: "c3" },
        },
        { op: "node.update", id: "c1-body", set: { props: { content: "2× the speed" } } },
      ],
    });
    expect(ops.isError).toBe(false);
    expect(ops.text).toContain("c3, c3-title, c3-body");

    const summary = await call("get_deck_summary");
    expect(summary.text).toContain('Components: "Feature card" (title, body, accent)');
    expect((await call("get_docs", { topic: "components" })).text).toContain("# Components");
  });

  it("tells the agent what to fix: names, params, values and existing components", async () => {
    await connect();
    await call("create_deck", { title: "Reuse" });
    await call("save_component", CARD);

    const unknown = await call("upsert_slide", {
      slide: { children: [{ type: "text", props: { content: "x" } }, { use: "Feature crad" }] },
    });
    expect(unknown.text).toMatch(
      /No component "Feature crad"[\s\S]*At: slide\.children\[1\]\.use[\s\S]*Did you mean "Feature card"/,
    );

    const param = await call("upsert_slide", {
      slide: { children: [{ use: "Feature card", with: { titel: "x" } }] },
    });
    expect(param.text).toMatch(
      /no param "titel"[\s\S]*slide\.children\[0\]\.with\.titel[\s\S]*"title"/,
    );

    const value = await call("upsert_slide", {
      slide: { children: [{ use: "Feature card", with: { accent: 42 } }] },
    });
    expect(value.text).toMatch(/"accent" doesn't fit card\.style\.fill/);
    expect(value.text).toContain("slide.children[0].with.accent");

    const again = await call("save_component", CARD);
    expect(again.text).toMatch(/already exists[\s\S]*overwrite: true/);
    expect((await call("save_component", { ...CARD, overwrite: true })).isError).toBe(false);

    const badTarget = await call("save_component", {
      ...CARD,
      name: "Broken",
      params: { title: "card-titel.props.content" },
    });
    expect(badTarget.text).toMatch(
      /targets node "card-titel"[\s\S]*At: params\.title\.targets\[0\][\s\S]*"card-title"/,
    );
  });

  it("saves a node already on a slide, and undo takes the component back", async () => {
    await connect();
    await call("create_deck", { title: "Reuse" });
    await call("upsert_slide", {
      slide: {
        id: "s1",
        children: [
          {
            id: "badge",
            layout: { mode: "stack" },
            children: [{ id: "badge-label", type: "text", props: { content: "New" } }],
          },
        ],
      },
    });
    const saved = await call("save_component", {
      name: "Badge",
      from: "badge",
      params: { label: "badge-label.props.content" },
    });
    expect(saved.isError).toBe(false);
    expect((await call("list_components")).text).toContain('"Badge"');
    expect((await call("save_component", { name: "X", from: "nope" })).text).toMatch(
      /No node or slide "nope"/,
    );

    await call("undo_agent_changes", {});
    const open = await workspace.get(workspace.activeDeckId as string);
    expect(open.deck.components).toBeUndefined();
  });
});

describe("slide layouts (D95)", () => {
  it("starts slides from a built-in layout, children in its slot, IDs from the slide's", async () => {
    await connect();
    await call("create_deck", { title: "Layouts" });
    const listed = await call("list_components");
    expect(listed.text).toContain('"Title and content" (built in, slot content)');
    expect((await call("get_deck_summary")).text).toContain(
      "Slide layouts: Title, Title and content",
    );

    const made = await call("upsert_slide", {
      slide: {
        id: "s1",
        use: "Title and content",
        with: { title: "Three reasons" },
        notes: "Say why",
        children: [{ id: "point", type: "text", props: { content: "Faster" } }],
      },
    });
    expect(made.text).toContain('s1-title: text "Three reasons"');
    const open = await workspace.get(workspace.activeDeckId as string);
    const slide = open.deck.slides[0];
    expect(slide?.notes).toBe("Say why");
    expect(slide?.root.children[1]).toMatchObject({
      id: "s1-content",
      children: [{ id: "point" }],
    });

    // Rebuilt: the same readable IDs again, not generated ones.
    const again = await call("upsert_slide", {
      slide: { id: "s1", use: "Section header", with: { title: "Part two" } },
    });
    expect(again.text).toContain('s1-title: text "Part two"');
    expect((await workspace.get(open.id)).deck.slides[0]?.background).toBe("$color.primary");
  });

  it("saves a slide as the deck's own layout, which replaces a built-in of that name", async () => {
    await connect();
    await call("create_deck", { title: "Layouts" });
    await call("upsert_slide", {
      slide: {
        id: "s1",
        background: "$color.surface",
        children: [
          { id: "big", type: "text", props: { content: "Hello", style: "$text.display" } },
        ],
      },
    });
    const saved = await call("save_component", {
      name: "Title",
      from: "s1",
      params: { title: "big.props.content" },
    });
    expect(saved.text).toContain('Save slide layout "Title": done');
    const made = await call("upsert_slide", {
      slide: { id: "s2", use: "Title", with: { title: "Hi" } },
    });
    expect(made.isError).toBe(false);
    const deck = (await workspace.get(workspace.activeDeckId as string)).deck;
    expect(deck.slides[1]).toMatchObject({ background: "$color.surface" });
    expect(deck.slides[1]?.root.children[0]).toMatchObject({
      id: "s2-big",
      props: { content: "Hi" },
    });
    expect((await call("list_components")).text).not.toContain('"Title" (built in');
  });

  it("says when a layout and a component are mixed up", async () => {
    await connect();
    await call("create_deck", { title: "Layouts" });
    const asNode = await call("upsert_slide", { slide: { children: [{ use: "Quote" }] } });
    expect(asNode.text).toMatch(/"Quote" is a slide layout[\s\S]*"use": "Quote"/);
    const styled = await call("upsert_slide", {
      slide: { use: "Quote", layout: { mode: "stack" } },
    });
    expect(styled.text).toMatch(/takes the layout's layout and style[\s\S]*At: slide\.layout/);
    const noSlot = await call("upsert_slide", {
      slide: { use: "Quote", children: [{ type: "text", props: { content: "x" } }] },
    });
    expect(noSlot.text).toMatch(/takes no children/);
    const typo = await call("upsert_slide", { slide: { use: "Titel" } });
    expect(typo.text).toMatch(/Did you mean "Title"/);
  });
});

describe("sections, footer and fields (D97)", () => {
  it("adds to a slide made in the same batch through its slide ID, and lists what it made", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const result = await call("apply_ops", {
      label: "Big number with a label",
      ops: [
        { op: "slide.insert", slide: { id: "big", use: "Big number", with: { number: "3×" } } },
        {
          op: "node.insert",
          parentId: "big", // the slide: its root frame's ID is generated
          node: { id: "label", type: "text", props: { content: "Onboarding" } },
        },
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/New node IDs: label\./);
    expect(result.text).toMatch(/New slides: big \(root frame nd_\w+; big-number, big-caption\)/);
    const open = await workspace.get(workspace.activeDeckId as string);
    expect(open.deck.slides[0]?.root.children.at(-1)?.id).toBe("label");
    // An existing slide's ID works too, for node.move as well.
    const moved = await call("apply_ops", {
      label: "Move it back",
      ops: [{ op: "node.move", id: "label", parentId: "big", index: 0 }],
    });
    expect(moved.isError).toBe(false);
  });

  it("takes field runs without text, and shows fields by name in outlines", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const made = await call("upsert_slide", {
      slide: {
        id: "s1",
        section: "Intro",
        children: [
          {
            id: "where",
            type: "text",
            props: {
              content: [
                { runs: [{ text: "Slide " }, { field: "slideNumber" }, { field: "section" }] },
              ],
            },
          },
        ],
      },
    });
    expect(made.isError).toBe(false);
    const summary = (await call("get_deck_summary")).text;
    expect(summary).toContain('[section "Intro"] 1. slide s1');
    expect(summary).not.toContain("[no section]");
    expect(summary).toContain('where: text "Slide {slideNumber}{section}"');
    const open = await workspace.get(workspace.activeDeckId as string);
    expect(open.deck.slides[0]?.root.children[0]).toMatchObject({
      props: { content: [{ runs: [{ text: "Slide " }, { text: "", field: "slideNumber" }, {}] }] },
    });

    // node.update: the same shorthand, and a run with neither says what a run needs.
    const update = (runs: unknown[]) =>
      call("apply_ops", {
        label: "Number",
        ops: [{ op: "node.update", id: "where", set: { props: { content: [{ runs }] } } }],
      });
    expect((await update([{ field: "slideCount" }])).isError).toBe(false);
    expect((await update([{ bold: true }])).text).toMatch(
      /A run needs "text" \(or a "field" for a live value/,
    );

    const empty = await call("apply_ops", {
      label: "Bad section",
      ops: [{ op: "slide.update", id: "s1", set: { section: "" } }],
    });
    expect(empty.text).toMatch(/A section needs a name\. To end a section at this slide/);
    // Not a node problem: no hint about nodes.
    const twoLines = await call("upsert_slide", { slide: { id: "s2", section: "A\nB" } });
    expect(twoLines.text).toMatch(/one line of text/);
    expect(twoLines.text).not.toMatch(/Nodes are/);

    // A slide before the first section is marked once.
    await call("upsert_slide", { slide: { id: "s0" }, index: 0 });
    expect((await call("get_deck_summary")).text).toContain("[no section: slide 1] 1. slide s0");
  });

  it("lints a slide a move knocked out of its section, though the move didn't name it", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const label = { type: "text", props: { content: [{ runs: [{ field: "section" }] }] } };
    await call("upsert_slide", { slide: { id: "a" } });
    await call("upsert_slide", { slide: { id: "b", section: "Results" } });
    await call("upsert_slide", { slide: { id: "c", children: [{ id: "lbl", ...label }] } });
    // Moving b (where Results starts) last leaves c before the first section.
    const moved = await call("apply_ops", {
      label: "Move b last",
      ops: [{ op: "slide.move", id: "b", index: 2 }],
    });
    expect(moved.text).toMatch(/section-field.*"lbl".*in no section/s);
    // Where slides went is said outright, for slides without a field too.
    expect(moved.text).toContain("Sections: c is now in no section."); // b still starts Results
    // A rename keeps every slide in its section: nothing to report.
    const renamed = await call("apply_ops", {
      label: "Rename",
      ops: [{ op: "slide.update", id: "b", set: { section: "Q3 Results" } }],
    });
    expect(renamed.text).not.toContain("Sections:");
    // Paragraphs stay apart in outlines.
    await call("upsert_slide", {
      slide: {
        id: "d",
        children: [{ id: "agenda", type: "text", props: { content: "One\nTwo" } }],
      },
    });
    expect((await call("get_deck_summary")).text).toContain('agenda: text "One / Two"');
  });

  it("puts a layout slide's free layers on the slide, even with no slot", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const corner = {
      id: "tag",
      type: "text",
      width: "hug",
      positioning: "free",
      anchor: { x: "end" },
      position: { x: 96, y: 40 },
      props: { content: [{ runs: [{ field: "section" }] }] },
    };
    const big = await call("upsert_slide", {
      slide: {
        id: "n",
        section: "Results",
        use: "Big number",
        with: { number: "3×" },
        children: [corner],
      },
    });
    expect(big.isError).toBe(false);
    const listed = await call("upsert_slide", {
      slide: {
        id: "t",
        use: "Title and content",
        with: { title: "Why" },
        children: [
          { id: "body", type: "text", props: { content: "Faster" } },
          { ...corner, id: "tag2" },
        ],
      },
    });
    expect(listed.isError).toBe(false);
    const open = await workspace.get(workspace.activeDeckId as string);
    const [n, t] = open.deck.slides;
    expect(n?.root.children.at(-1)?.id).toBe("tag");
    expect(t?.root.children.map((c) => c.id)).toEqual(["t-title", "t-content", "tag2"]);
    expect(t?.root.children[1]).toMatchObject({ children: [{ id: "body" }] });
  });

  it("saves a corner label once and puts it on any layout slide with one line (docs flow)", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const saved = await call("save_component", {
      name: "Section label",
      node: {
        type: "text",
        width: "hug",
        positioning: "free",
        anchor: { x: "end" },
        position: { x: 96, y: 40 },
        props: { content: [{ runs: [{ field: "section" }] }], style: "$text.small" },
      },
    });
    expect(saved.isError).toBe(false);
    const label = { use: "Section label" };
    for (const slide of [
      { id: "a", section: "Results", use: "Big number", with: { number: "3×" }, children: [label] },
      {
        id: "b",
        use: "Title and content",
        with: { title: "Why" },
        children: [
          { id: "pt", type: "text", props: { content: "Faster", style: "$text.lead" } },
          label,
        ],
      },
    ]) {
      expect((await call("upsert_slide", { slide })).isError).toBe(false);
    }
    const open = await workspace.get(workspace.activeDeckId as string);
    const [a, b] = open.deck.slides;
    expect(a?.root.children.at(-1)).toMatchObject({ positioning: "free", type: "text" });
    expect(b?.root.children.map((c) => c.kind)).toEqual(["element", "frame", "element"]);
    expect(b?.root.children[1]).toMatchObject({ id: "b-content", children: [{ id: "pt" }] });
    // The layouts' own text is lead, which every theme has (v2).
    expect(b?.root.children[0]).toMatchObject({ props: { style: "$text.h1" } });
    expect(open.deck.theme.text.lead).toBeDefined();
  });

  it("tells a frame written as an element how to write it, and names copies after their component", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    const frame = await call("apply_ops", {
      label: "Cards",
      ops: [
        {
          op: "slide.insert",
          slide: {
            id: "s",
            children: [{ type: "frame", layout: { mode: "stack" }, children: [] }],
          },
        },
      ],
    });
    expect(frame.text).toMatch(/How to fix: A frame has no "type"/);

    await call("save_component", {
      name: "Section label",
      node: { type: "text", props: { content: "x" } },
    });
    const made = await call("upsert_slide", {
      slide: { id: "s", children: [{ use: "Section label" }, { use: "Section label" }] },
    });
    expect(made.text).toContain("section-label: text");
    expect(made.text).toContain("section-label-2: text");
  });

  it("names the footer's keys, and says 'no footer' only when there's one", async () => {
    await connect();
    await call("create_deck", { title: "Review" });
    await call("upsert_slide", { slide: { id: "a", hideFooter: true } });
    expect((await call("get_deck_summary")).text).not.toContain("no footer");
    const typo = await call("apply_ops", {
      label: "Footer",
      ops: [{ op: "deck.setFooter", footer: { slideNum: true } }],
    });
    expect(typo.text).toMatch(/"slideNumber"\?: true/);
    await call("apply_ops", {
      label: "Footer",
      ops: [{ op: "deck.setFooter", footer: { slideNumber: true } }],
    });
    expect((await call("get_deck_summary")).text).toContain("no footer");
  });

  it("finds its docs under every name an agent tries, and the instructions point there", async () => {
    await connect();
    for (const topic of ["sections", "footer", "fields", "slide numbers"]) {
      expect((await call("get_docs", { topic })).text).toMatch(/^# Sections, footer and fields/);
    }
    expect(INSTRUCTIONS).toContain('get_docs("sections")');
  });
});

describe("decks the user deletes (D99)", () => {
  it("tells an agent its deck went to the trash, and not to recreate it", async () => {
    await connect();
    await call("create_deck", { title: "Doomed" });
    await workspace.delete(workspace.activeDeckId as string);
    const after = await call("get_deck_summary");
    expect(after.isError).toBe(true);
    expect(after.text).toMatch(
      /The user moved your current deck \(\w+\) to the trash: that's their decision/,
    );
    expect(after.text).toMatch(/How to fix: list_decks, then open_deck/);
  });
});
