// @vitest-environment happy-dom
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { renderParagraphs, type TextProps, TextPropsSchema, textElement } from "./index.js";

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
