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
    expect(summary).not.toMatch(/foot/);

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
