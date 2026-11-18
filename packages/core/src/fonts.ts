/**
 * The fonts every Veloce install ships with (SIL Open Font License 1.1, bundled by the editor
 * and the render page), so a deck that uses them looks identical on every machine, offline,
 * and in headless previews. Themes reference them by CSS font stack; the fallbacks after the
 * family only matter if a deck is opened somewhere without the bundle.
 *
 * Pure data, shared by the editor's font picker and the AI's theme docs.
 */
export interface BundledFont {
  /** The CSS family name, as registered with `@font-face`. */
  family: string;
  /** What a theme's `fonts` entry should be. */
  stack: string;
  category: "sans" | "serif" | "display" | "mono";
  /** One line on when to use it (shown to people and agents). */
  note: string;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: "Inter",
    stack: "Inter, system-ui, sans-serif",
    category: "sans",
    note: "Neutral, very legible sans. The default for headings and body.",
  },
  {
    family: "Manrope",
    stack: "Manrope, system-ui, sans-serif",
    category: "sans",
    note: "Modern, slightly rounded sans: friendly product and startup decks.",
  },
  {
    family: "Space Grotesk",
    stack: "'Space Grotesk', system-ui, sans-serif",
    category: "display",
    note: "Characterful grotesk for bold headings; pair with Manrope or Inter body.",
  },
  {
    family: "Fraunces",
    stack: "Fraunces, Georgia, serif",
    category: "serif",
    note: "Expressive display serif for editorial headings.",
  },
  {
    family: "Lora",
    stack: "Lora, Georgia, serif",
    category: "serif",
    note: "Calm text serif: long-form body copy, quotes.",
  },
  {
    family: "JetBrains Mono",
    stack: "'JetBrains Mono', ui-monospace, monospace",
    category: "mono",
    note: "Monospace for code.",
  },
];

/** The first family of a CSS font stack, unquoted: `"'Space Grotesk', sans-serif"` → `"Space Grotesk"`. */
export function primaryFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** The bundled font a stack starts with, if any. */
export function bundledFont(stack: string): BundledFont | undefined {
  const family = primaryFamily(stack).toLowerCase();
  return BUNDLED_FONTS.find((f) => f.family.toLowerCase() === family);
}
