import type { Paragraph, RichText, TextContent } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  DOC,
  type DocNode,
  fromDoc,
  normalizeContent,
  normalizeLink,
  sameContent,
  toContent,
  toDoc,
} from "./rich-text-doc.js";

const roundTrip = (content: TextContent) => toContent(fromDoc(toDoc(content)));
const bullet = (text: string, level = 0): Paragraph => ({
  runs: [{ text }],
  list: "bullet",
  ...(level ? { level } : {}),
});

describe("toDoc", () => {
  it("turns a plain string into one paragraph per line, empty lines without text nodes", () => {
    expect(toDoc("One\n\nTwo")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { align: null, textStyle: null },
          content: [{ type: "text", text: "One" }],
        },
        { type: "paragraph", attrs: { align: null, textStyle: null } },
        {
          type: "paragraph",
          attrs: { align: null, textStyle: null },
          content: [{ type: "text", text: "Two" }],
        },
      ],
    });
  });

  it("always has at least one paragraph", () => {
    expect(toDoc([]).content).toHaveLength(1);
  });

  it("maps run formatting to marks", () => {
    const doc = toDoc([
      {
        runs: [
          { text: "b", bold: true, italic: true },
          { text: "l", link: "https://x.dev", color: "$color.primary" },
        ],
      },
    ]);
    expect(doc.content?.[0]?.content).toEqual([
      { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
      {
        type: "text",
        text: "l",
        marks: [
          { type: "link", attrs: { href: "https://x.dev" } },
          { type: DOC.color, attrs: { color: "$color.primary" } },
        ],
      },
    ]);
  });

  it("nests flat list paragraphs like the renderer does", () => {
    const doc = toDoc([
      bullet("a"),
      bullet("a1", 1),
      bullet("b"),
      { runs: [{ text: "n" }], list: "number" },
      { runs: [{ text: "after" }] },
    ]);
    const types = (n: DocNode): unknown =>
      n.type === "text" ? n.text : [n.type, ...(n.content ?? []).map(types)];
    expect(types(doc)).toEqual([
      "doc",
      [
        "bulletList",
        ["listItem", ["paragraph", "a"], ["bulletList", ["listItem", ["paragraph", "a1"]]]],
        ["listItem", ["paragraph", "b"]],
      ],
      ["orderedList", ["listItem", ["paragraph", "n"]]],
      ["paragraph", "after"],
    ]);
  });
});

describe("fromDoc / toContent", () => {
  it("keeps plain text as a string", () => {
    expect(roundTrip("Hello\nWorld")).toBe("Hello\nWorld");
    expect(roundTrip("")).toBe("");
    // Rich content without any formatting collapses to the plain form.
    expect(roundTrip([{ runs: [{ text: "a" }] }, { runs: [] }])).toBe("a\n");
  });

  it("round-trips formatting, lists, alignment and paragraph styles", () => {
    const rich: RichText = [
      { runs: [{ text: "Title" }], style: "$text.h2", align: "center" },
      {
        runs: [
          { text: "plain " },
          { text: "bold", bold: true },
          { text: " code", code: true, underline: true, strike: true },
          { text: " link", link: "mailto:a@b.c", color: "#ff0000" },
        ],
      },
      bullet("one"),
      bullet("deep", 1),
      { runs: [{ text: "first" }], list: "number" },
      { runs: [] },
    ];
    expect(roundTrip(rich)).toEqual(rich);
  });

  it("normalizes list levels that skip a step (the renderer nests them one deep)", () => {
    expect(roundTrip([bullet("a"), bullet("c", 2)])).toEqual([bullet("a"), bullet("c", 1)]);
  });

  it("merges adjacent runs with the same formatting", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "text", text: "c" },
          ],
        },
      ],
    };
    expect(fromDoc(doc)).toEqual([{ runs: [{ text: "ab", bold: true }, { text: "c" }] }]);
  });

  it("drops values the core schema would refuse (e.g. pasted javascript: links)", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { align: "sideways", textStyle: "Heading 1" },
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: DOC.color, attrs: { color: "not a color" } },
                { type: "highlight" },
              ],
            },
          ],
        },
      ],
    };
    expect(fromDoc(doc)).toEqual([{ runs: [{ text: "x" }] }]);
  });

  it("keeps the text of unexpected blocks", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }],
        },
      ],
    };
    expect(toContent(fromDoc(doc))).toBe("q");
  });

  it("detects edits that changed nothing", () => {
    const content: RichText = [{ runs: [{ text: "a" }] }];
    expect(sameContent(normalizeContent(content), roundTrip(content))).toBe(true);
    expect(sameContent(normalizeContent(content), "b")).toBe(false);
  });
});

describe("normalizeLink", () => {
  it("completes bare addresses and refuses unsafe schemes", () => {
    expect(normalizeLink(" https://veloce.dev ")).toBe("https://veloce.dev");
    expect(normalizeLink("veloce.dev/docs")).toBe("https://veloce.dev/docs");
    expect(normalizeLink("hi@veloce.dev")).toBe("mailto:hi@veloce.dev");
    expect(normalizeLink("mailto:hi@veloce.dev")).toBe("mailto:hi@veloce.dev");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("data:text/html,x")).toBeNull();
    expect(normalizeLink("   ")).toBeNull();
  });
});

describe("fields (D97)", () => {
  const numbered: RichText = [
    {
      runs: [
        { text: "Slide " },
        { text: "3", field: "slideNumber", bold: true },
        { text: "", field: "slideCount" },
      ],
    },
  ];

  it("become inline field nodes with their marks, and come back as field runs", () => {
    expect(toDoc(numbered).content?.[0]?.content).toEqual([
      { type: DOC.text, text: "Slide " },
      { type: DOC.field, attrs: { field: "slideNumber", text: "3" }, marks: [{ type: "bold" }] },
      { type: DOC.field, attrs: { field: "slideCount", text: "" } }, // empty text still kept
    ]);
    expect(roundTrip(numbered)).toEqual(numbered);
  });

  it("never merge with the text or the field next to them", () => {
    const twice: RichText = [
      {
        runs: [
          { text: "", field: "date" },
          { text: "", field: "date" },
        ],
      },
    ];
    expect(roundTrip(twice)).toEqual(twice);
  });

  it("drop a field the model doesn't know (pasted or tampered)", () => {
    const doc: DocNode = {
      type: DOC.doc,
      content: [
        {
          type: DOC.paragraph,
          content: [
            { type: DOC.text, text: "Page " },
            { type: DOC.field, attrs: { field: "pageNumber", text: "1" } },
          ],
        },
      ],
    };
    expect(toContent(fromDoc(doc))).toBe("Page ");
  });
});
