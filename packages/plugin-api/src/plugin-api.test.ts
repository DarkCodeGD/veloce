// @vitest-environment happy-dom
import { applyTransaction, createDeck, createSlide, DEFAULT_THEME, element } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkElementConformance } from "./conformance.js";
import { cssPaint } from "./css.js";
import { PluginRegistry } from "./registry.js";
import { defineElement, definePlugin, type ElementDefinition } from "./types.js";

const DOCS =
  "Use badge for short status labels. Props: label (string). Example: { label: 'New' }. Keep it short.";

/** A well-behaved element: renders a span, listens for clicks, cleans up after itself. */
function badge(type = "acme.badge"): ElementDefinition<{ label: string }> {
  return defineElement({
    type,
    title: "Badge",
    description: "A small status label.",
    propsSchema: z.strictObject({ label: z.string().max(40) }),
    defaultProps: { label: "New" },
    deterministic: true,
    aiDocs: DOCS,
    mount(container, props) {
      const span = document.createElement("span");
      const onClick = () => {};
      span.addEventListener("click", onClick);
      span.textContent = props.label;
      container.append(span);
      return {
        update: (next) => {
          span.textContent = next.label;
        },
        seek: () => {},
        dispose: () => {
          span.removeEventListener("click", onClick);
          span.remove();
        },
      };
    },
  });
}

const plugin = (elements: ElementDefinition<{ label: string }>[], id = "acme.badges") =>
  definePlugin({ manifest: { id, name: "Badges", version: "1.0.0" }, elements });

describe("PluginRegistry", () => {
  it("registers plugins and validates element props for core", () => {
    const registry = new PluginRegistry().register(plugin([badge()]));
    expect(registry.types()).toEqual(["acme.badge"]);
    expect(registry.validateElement("acme.badge", { label: "Hi" })).toEqual({ ok: true });
    expect(registry.validateElement("acme.badge", { label: 5 })).toEqual({
      ok: false,
      reason: "invalid-props",
      message: "props.label: Invalid input: expected string, received number",
    });
    expect(registry.validateElement("acme.bagde", {})).toMatchObject({
      reason: "unknown-type",
      message: 'Unknown element type "acme.bagde". Did you mean "acme.badge"?',
    });
  });

  it("plugs into core transactions", () => {
    const registry = new PluginRegistry().register(plugin([badge()]));
    const deck = createDeck({ title: "t", slides: [createSlide({ id: "s", rootId: "root" })] });
    const insert = (props: Record<string, unknown>) =>
      applyTransaction(
        deck,
        {
          origin: "agent:test",
          label: "add",
          ops: [{ op: "node.insert", parentId: "root", node: element("acme.badge", props) }],
        },
        registry.applyContext(),
      );
    expect(insert({ label: "ok" }).ok).toBe(true);
    const bad = insert({ label: "x".repeat(41) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/props\.label: Too big/);
  });

  it("refuses bad manifests, duplicate types, bare types from third parties and invalid defaults", () => {
    const registry = new PluginRegistry().register(plugin([badge()]));
    expect(() => registry.register(plugin([badge()], "acme.other"))).toThrow(
      /already provided by "acme.badges"/,
    );
    expect(() => registry.register(plugin([badge("badge")], "acme.bare"))).toThrow(
      /must be namespaced/,
    );
    expect(() => registry.register(plugin([], "NoNamespace"))).toThrow(/Invalid plugin manifest/);
    const broken = { ...badge("acme.broken"), defaultProps: { label: 7 as unknown as string } };
    expect(() => registry.register(plugin([broken], "acme.broken"))).toThrow(
      /defaultProps don't match/,
    );
    // Built-ins (veloce.*) may use bare types.
    expect(() => registry.register(plugin([badge("badge")], "veloce.badge"))).not.toThrow();
  });

  it("describes element types with JSON Schema for AI tools, and builds lockfiles", () => {
    const registry = new PluginRegistry().register(plugin([badge()]));
    const info = registry.describe("acme.badge");
    expect(info?.propsJsonSchema).toMatchObject({
      type: "object",
      properties: { label: { type: "string", maxLength: 40 } },
      required: ["label"],
      additionalProperties: false,
    });
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({ children: [element("acme.badge", { label: "x" }), element("other", {})] }),
      ],
    });
    expect(registry.lockFor(deck)).toEqual({ "acme.badges": "1.0.0" });
    expect(registry.unregister("acme.badges")).toBe(true);
    expect(registry.has("acme.badge")).toBe(false);
  });
});

describe("css helpers", () => {
  const url = (id: string) => `blob:${id.slice(0, 4)}`;
  it("turns paints into CSS backgrounds, tokens into var() references", () => {
    expect(cssPaint("$color.primary", url)).toBe("var(--v-color-primary)");
    expect(cssPaint("#fff", url)).toBe("#fff");
    expect(
      cssPaint(
        {
          type: "linear-gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "$color.accent" },
          ],
        },
        url,
      ),
    ).toBe("linear-gradient(90deg, #000 0%, var(--v-color-accent) 100%)");
    // Radial gradients fit the box: offset 1 is the edge of an ellipse filling it (a glow fades
    // out inside the shape instead of being cut off at its outline).
    expect(
      cssPaint(
        {
          type: "radial-gradient",
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "transparent" },
          ],
        },
        url,
      ),
    ).toBe("radial-gradient(ellipse farthest-side at 50% 50%, #fff 0%, transparent 100%)");
    expect(
      cssPaint({ type: "image", asset: `asset:${"ab".repeat(32)}`, fit: "contain" }, url),
    ).toBe('url("blob:abab") center / contain no-repeat');
    expect(DEFAULT_THEME.colors.primary).toBeDefined();
  });
});

describe("conformance kit", () => {
  it("passes a well-behaved element", async () => {
    const report = await checkElementConformance(badge(), { updates: [{ label: "Updated" }] });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("catches leaked listeners, timers and DOM", async () => {
    const leaky = defineElement({
      ...badge("acme.leaky"),
      mount(container) {
        container.append(document.createElement("i"));
        window.addEventListener("resize", () => {});
        setInterval(() => {}, 1000);
        requestAnimationFrame(() => {});
        return { update() {}, seek() {}, dispose() {} };
      },
    });
    const report = await checkElementConformance(leaky);
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      "dispose() left DOM nodes in the container",
      'dispose() leaked an event listener ("resize")',
      "dispose() leaked a running interval",
      "dispose() leaked a pending animation frame",
    ]);
  });

  it("catches touching the container, non-determinism and weak docs", async () => {
    let calls = 0;
    const rude = defineElement({
      ...badge("acme.rude"),
      aiDocs: "short",
      mount(container) {
        container.style.color = "red";
        const span = document.createElement("span");
        container.append(span);
        return {
          update() {},
          seek: () => {
            span.textContent = String(calls++);
          },
          dispose: () => span.remove(),
        };
      },
    });
    const report = await checkElementConformance(rude);
    expect(report.failures).toEqual([
      "aiDocs is too short to teach an AI agent anything (min 80 chars)",
      "mount() changed the container's own attributes/style (only add children; the renderer owns the container)",
      "declared deterministic, but seek(0.5) rendered differently the second time",
    ]);
  });

  it("listeners removed via AbortSignal or `once` don't count as leaks, and globals are restored", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const tidy = defineElement({
      ...badge("acme.tidy"),
      mount(container) {
        const controller = new AbortController();
        const span = document.createElement("span");
        container.append(span);
        window.addEventListener("resize", () => {}, { signal: controller.signal });
        span.addEventListener("click", () => {}, { once: true });
        span.click(); // a `once` listener that has fired is gone
        return {
          update() {},
          seek() {},
          dispose() {
            controller.abort();
            span.remove();
          },
        };
      },
    });
    expect((await checkElementConformance(tidy)).failures).toEqual([]);
    expect(globalThis.setTimeout).toBe(originalSetTimeout);
  });
});
