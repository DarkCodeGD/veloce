// @vitest-environment happy-dom
import { element, motionTokens } from "@veloce/core";
import {
  checkEffectConformance,
  checkElementConformance,
  PluginRegistry,
} from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import {
  countedText,
  countUpEffect,
  renderParagraphs,
  type TextProps,
  TextPropsSchema,
  textElement,
  textPlugin,
  typewriterEffect,
} from "./index.js";

function mount(props: TextProps): HTMLElement {
  const container = document.createElement("div");
  textElement.mount(container, props, { assetUrl: () => "" });
  return container;
}

describe("text element", () => {
  it("passes the plugin conformance kit", async () => {
    const report = await checkElementConformance(textElement, {
      updates: [
        {
          content: [
            {
              runs: [
                { text: "Bold", bold: true },
                { text: " link", link: "https://veloce.dev" },
              ],
            },
          ],
        },
        {
          content: "a\nb",
          style: "$text.h1",
          align: "center",
          verticalAlign: "middle",
          color: "$color.muted",
        },
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("styles text through theme token variables", () => {
    const box = mount({ content: "Hello", style: "$text.h1" }).firstElementChild as HTMLElement;
    expect(box.style.fontSize).toBe("var(--v-text-h1-size)");
    expect(box.style.color).toBe("var(--v-color-text)");
    expect(box.textContent).toBe("Hello");
  });

  it("gives a paragraph with its own style the whole style, letter-spacing and case included", () => {
    const container = mount({
      content: [{ runs: [{ text: "Big" }], style: "$text.display" }, { runs: [{ text: "Body" }] }],
    });
    const [styled, plain] = [...container.querySelectorAll("p")];
    expect(styled?.style.fontSize).toBe("var(--v-text-display-size)");
    expect(styled?.style.letterSpacing).toBe("var(--v-text-display-letter-spacing)");
    expect(styled?.style.textTransform).toBe("var(--v-text-display-transform)");
    expect(plain?.getAttribute("style")).toBe("margin: 0px;"); // inherits the layer's style
  });

  it("never interprets content as HTML (XSS)", () => {
    const container = mount({ content: '<img src=x onerror="alert(1)"><script>alert(2)</script>' });
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("only renders http(s)/mailto links, even if unvalidated props slip through", () => {
    const container = mount({
      content: [
        {
          runs: [
            { text: "ok", link: "https://veloce.dev" },
            { text: "evil", link: "javascript:alert(1)" },
          ],
        },
      ],
    });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://veloce.dev");
    expect(links[0]?.rel).toBe("noopener noreferrer");
    // The text's own color, underlined: never the browser's blue (it ignores the theme).
    expect(links[0]?.style.color).toBe("inherit");
    expect(links[0]?.style.textDecorationLine).toBe("underline");
    expect(
      TextPropsSchema.safeParse({ content: [{ runs: [{ text: "x", link: "javascript:x" }] }] })
        .success,
    ).toBe(false);
  });

  it("groups list paragraphs into nested semantic lists", () => {
    const wrapper = document.createElement("div");
    wrapper.append(
      ...renderParagraphs([
        { runs: [{ text: "Intro" }] },
        { runs: [{ text: "One" }], list: "bullet" },
        { runs: [{ text: "One.a" }], list: "bullet", level: 1 },
        { runs: [{ text: "Two" }], list: "bullet" },
        { runs: [{ text: "Step" }], list: "number" },
      ]),
    );
    expect(wrapper.innerHTML.replace(/ style="[^"]*"/g, "")).toBe(
      "<p><span>Intro</span></p>" +
        "<ul><li><span>One</span><ul><li><span>One.a</span></li></ul></li><li><span>Two</span></li></ul>" +
        "<ol><li><span>Step</span></li></ol>",
    );
  });

  it("keeps empty lines one line tall", () => {
    const container = mount({ content: "a\n\nb" });
    expect(container.querySelectorAll("p")[1]?.innerHTML).toBe("<br>");
  });
});

describe("text effects (D117)", () => {
  const registry = new PluginRegistry().register(textPlugin);
  const title = element("text", { content: "Hello there" }, { id: "t" });

  it.each([typewriterEffect, countUpEffect])(
    "$name passes the effect conformance kit",
    (effect) => {
      const report = checkEffectConformance(effect, {
        target: title,
        context: registry.applyContext(),
      });
      expect(report.failures).toEqual([]);
    },
  );

  it("plays only on text layers", () => {
    const shape = element("shape", { shape: "rect" }, { id: "s" });
    expect(registry.validateEffect({ name: "typewriter" }, shape)).toMatchObject({
      ok: false,
      reason: "wrong-target",
    });
  });

  it("types for as long as the text is, at the level's pace", () => {
    const duration = (content: string, level: "calm" | "subtle") =>
      registry.resolveEffect(
        { name: "typewriter" },
        {
          animation: {} as never,
          target: element("text", { content }, { id: "t" }),
          tokens: motionTokens(undefined, level),
        },
      )?.duration;
    expect(duration("Hello there", "subtle")).toBe(440); // 11 characters × 40 ms
    expect(duration("Hi", "subtle")).toBe(400); // never quicker than $motion.normal
    expect(duration("Hello there", "calm")).toBe(550); // calm types slower
    expect(duration("x".repeat(1000), "subtle")).toBe(8000);
  });

  it("types out text without moving it: what's not typed yet keeps its place", () => {
    const [p] = renderParagraphs(
      [{ runs: [{ text: "Hello " }, { text: "world", bold: true }] }, { runs: [{ text: "Next" }] }],
      null,
      { reveal: 0.5 },
    ) as HTMLElement[];
    // 15 characters, 7 shown: "Hello " and the "w" of "world".
    expect(p?.textContent).toBe("Hello world");
    const hidden = [...(p?.querySelectorAll<HTMLElement>("span span") ?? [])];
    expect(hidden.map((h) => [h.textContent, h.style.visibility])).toEqual([["orld", "hidden"]]);
    const rest = renderParagraphs([{ runs: [{ text: "a" }] }, { runs: [{ text: "b" }] }], null, {
      reveal: 0.5,
    }) as HTMLElement[];
    expect(rest[1]?.style.visibility).toBe("hidden"); // a paragraph not reached, bullet and all
    const done = renderParagraphs("Hello", null, { reveal: 1 }) as HTMLElement[];
    expect(done[0]?.querySelector("span span")).toBeNull();
  });

  it("counts numbers up keeping how they're written", () => {
    expect(countedText("$4.2M raised", 0.5)).toBe("$2.1M raised");
    expect(countedText("12,500 users", 0.5)).toBe("6,250 users");
    expect(countedText("1,234,567", 0.1)).toBe("123,457");
    expect(countedText("99% of 40", 0)).toBe("0% of 0");
    expect(countedText("v2.0 from 12", 1)).toBe("v2.0 from 12"); // untouched when done
  });

  it("draws the counted text when mounted with countUp", () => {
    const box = mount({ content: "1,000 users", countUp: 0.25 });
    expect(box.textContent).toBe("250 users");
  });
});
