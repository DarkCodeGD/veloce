import { describe, expect, it } from "vitest";
import { footerDraft, footerOf, setFooterCommand } from "./footer.js";

describe("the footer form (D97)", () => {
  it("reads the deck's footer, and keeps only what's on", () => {
    expect(footerDraft(undefined)).toEqual({ date: false, text: "", slideNumber: false });
    expect(footerOf({ date: false, text: "  Acme  ", slideNumber: true })).toEqual({
      text: "Acme",
      slideNumber: true,
    });
    expect(footerOf({ date: false, text: "   ", slideNumber: false })).toBeNull();
  });

  it("adds, changes and removes the footer as one deck.setFooter, or does nothing", () => {
    const on = { date: false, text: "", slideNumber: true };
    expect(setFooterCommand(undefined, on)).toEqual({
      label: "Add footer",
      ops: [{ op: "deck.setFooter", footer: { slideNumber: true } }],
    });
    expect(setFooterCommand({ slideNumber: true }, { ...on, date: true })?.label).toBe(
      "Change footer",
    );
    expect(setFooterCommand({ slideNumber: true }, { ...on, slideNumber: false })).toEqual({
      label: "Remove footer",
      ops: [{ op: "deck.setFooter", footer: null }],
    });
    expect(setFooterCommand({ slideNumber: true }, on)).toBeNull();
    expect(setFooterCommand(undefined, { ...on, slideNumber: false })).toBeNull();
  });
});
