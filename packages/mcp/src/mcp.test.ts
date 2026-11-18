import { mkdtemp, rm } from "node:fs/promises";
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
import { type RenderService, Workspace } from "@veloce/doc-server";
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

async function connect(render: RenderService | null = fakeRender) {
  workspace = await Workspace.open({
    dir,
    context: createBuiltinRegistry().applyContext(),
    autosaveDelayMs: 5,
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
    expect(undo.text).toBe('Undid 1 step: "Shorten tagline".');
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
    expect((await call("get_docs", { topic: "theme" })).text).toMatch(
      /`\$color\.primary`: #8b6dff/,
    );
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
    expect(list).toMatch(/"Two" · 0 slides · two\.veloce · CURRENT/);
    const one = workspace.list().find((d) => d.title === "One");
    await call("open_deck", { deckId: one?.id });
    expect(workspace.activeDeckId).toBe(one?.id);
    const resource = await client.readResource({ uri: "deck://current/summary" });
    expect(resource.contents[0]).toMatchObject({ text: expect.stringMatching(/^Deck "One"/) });
  });
});
