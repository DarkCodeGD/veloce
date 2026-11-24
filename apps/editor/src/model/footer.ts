/**
 * Insert → Footer and slide numbers… (D97): the deck's footer as a form, saved as one
 * `deck.setFooter` (the op agents use). Pure, so it's tested without a browser.
 */
import type { Footer } from "@veloce/core";
import type { Command } from "./commands.js";

export interface FooterDraft {
  date: boolean;
  text: string;
  slideNumber: boolean;
}

export const footerDraft = (footer: Footer | undefined): FooterDraft => ({
  date: footer?.date === true,
  text: footer?.text ?? "",
  slideNumber: footer?.slideNumber === true,
});

/** The footer a draft describes: only what's on, or null when nothing is. */
export function footerOf(draft: FooterDraft): Footer | null {
  const text = draft.text.trim();
  const footer: Footer = {
    ...(draft.date && { date: true }),
    ...(text && { text }),
    ...(draft.slideNumber && { slideNumber: true }),
  };
  return Object.keys(footer).length > 0 ? footer : null;
}

/** The command that saves `draft`, or null when it changes nothing. */
export function setFooterCommand(current: Footer | undefined, draft: FooterDraft): Command | null {
  const footer = footerOf(draft);
  if (JSON.stringify(footer) === JSON.stringify(current ? footerOf(footerDraft(current)) : null)) {
    return null;
  }
  const label = !footer ? "Remove footer" : current ? "Change footer" : "Add footer";
  return { label, ops: [{ op: "deck.setFooter", footer }] };
}
