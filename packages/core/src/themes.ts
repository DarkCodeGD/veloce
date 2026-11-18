/**
 * Built-in themes. Every theme defines the same token names as `DEFAULT_THEME`, so content
 * written for one theme (`$color.primary`, `$text.h1`…) works in all of them and switching
 * themes restyles a deck without touching its slides.
 */
import { DEFAULT_THEME } from "./default-theme.js";
import type { Theme } from "./schema/theme.js";

const DARK_SHADOWS: Theme["shadow"] = {
  sm: { x: 0, y: 2, blur: 6, color: "#00000066" },
  md: { x: 0, y: 8, blur: 24, color: "#00000080" },
  lg: { x: 0, y: 24, blur: 64, color: "#00000099" },
};

export const DARK_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "Veloce Dark",
  colors: {
    background: "#0b0d12",
    surface: "#161a22",
    text: "#f3f4f6",
    muted: "#9aa3b2",
    border: "#2a303c",
    primary: "#818cf8",
    "on-primary": "#0b0d12",
    secondary: "#38bdf8",
    accent: "#fbbf24",
    success: "#4ade80",
    danger: "#f87171",
  },
  shadow: DARK_SHADOWS,
};

export const MIDNIGHT_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "Midnight",
  colors: {
    background: "#0a1024",
    surface: "#141c3a",
    text: "#eef2ff",
    muted: "#a5b0d4",
    border: "#26305a",
    // Light enough to read as text on the background and on surface cards (≥4.5:1), so
    // labels on primary fills use the dark background color instead of white.
    primary: "#8b6dff",
    "on-primary": "#0a1024",
    secondary: "#22d3ee",
    accent: "#f472b6",
    success: "#34d399",
    danger: "#fb7185",
  },
  text: {
    ...DEFAULT_THEME.text,
    display: { font: "heading", size: 120, weight: 900, lineHeight: 1.05, letterSpacing: -0.02 },
    caption: {
      font: "body",
      size: 20,
      weight: 600,
      lineHeight: 1.3,
      letterSpacing: 0.12,
      transform: "uppercase",
    },
  },
  shadow: DARK_SHADOWS,
};

export const EMBER_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "Ember",
  colors: {
    background: "#fffaf5",
    surface: "#fbeee2",
    text: "#1f1612",
    muted: "#6f5d52",
    border: "#efd9c6",
    primary: "#c2410c",
    "on-primary": "#ffffff",
    secondary: "#0f766e",
    accent: "#db2777",
    success: "#15803d",
    danger: "#b91c1c",
  },
  radius: { sm: 6, md: 12, lg: 24, full: 9999 },
};

/** Light and editorial: serif headings (Fraunces) over a calm text serif (Lora), warm paper. */
export const PAPER_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "Paper",
  colors: {
    background: "#fbf8f3",
    surface: "#f1ebe1",
    text: "#1d1a16",
    muted: "#5f574d",
    border: "#e2d8c8",
    primary: "#8a3b12",
    "on-primary": "#ffffff",
    secondary: "#1f5f7a",
    accent: "#b4235a",
    success: "#2f7a3b",
    danger: "#b42318",
  },
  fonts: {
    heading: "Fraunces, Georgia, serif",
    body: "Lora, Georgia, serif",
    mono: DEFAULT_THEME.fonts.mono as string,
  },
  text: {
    ...DEFAULT_THEME.text,
    display: { font: "heading", size: 120, weight: 700, lineHeight: 1.05, letterSpacing: -0.02 },
    h1: { font: "heading", size: 80, weight: 650, lineHeight: 1.1, letterSpacing: -0.01 },
    h2: { font: "heading", size: 56, weight: 600, lineHeight: 1.15 },
    body: { font: "body", size: 32, weight: 400, lineHeight: 1.5 },
  },
  radius: { sm: 4, md: 8, lg: 16, full: 9999 },
};

/** Dark and bold: a grotesk for headings (Space Grotesk), Manrope body, an electric lime. */
export const STUDIO_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "Studio",
  colors: {
    background: "#111111",
    surface: "#1c1c1c",
    text: "#f5f5f0",
    muted: "#a3a39b",
    border: "#2e2e2e",
    primary: "#d4ff3f",
    "on-primary": "#111111",
    secondary: "#7dd3fc",
    accent: "#ff6b4a",
    success: "#4ade80",
    danger: "#f87171",
  },
  fonts: {
    heading: "'Space Grotesk', system-ui, sans-serif",
    body: "Manrope, system-ui, sans-serif",
    mono: DEFAULT_THEME.fonts.mono as string,
  },
  text: {
    ...DEFAULT_THEME.text,
    display: { font: "heading", size: 128, weight: 700, lineHeight: 1, letterSpacing: -0.04 },
    h1: { font: "heading", size: 84, weight: 700, lineHeight: 1.05, letterSpacing: -0.03 },
    caption: {
      font: "body",
      size: 20,
      weight: 700,
      lineHeight: 1.3,
      letterSpacing: 0.14,
      transform: "uppercase",
    },
  },
  radius: { sm: 4, md: 10, lg: 20, full: 9999 },
  shadow: DARK_SHADOWS,
};

/** Built-in themes keyed by their short ID (what `set_theme` and the UI accept). */
export const BUILTIN_THEMES: Readonly<Record<string, Theme>> = {
  light: DEFAULT_THEME,
  dark: DARK_THEME,
  midnight: MIDNIGHT_THEME,
  ember: EMBER_THEME,
  paper: PAPER_THEME,
  studio: STUDIO_THEME,
};

/** Look a built-in theme up by ID (`"dark"`) or display name (`"Veloce Dark"`), case-insensitively. */
export function findBuiltinTheme(nameOrId: string): Theme | undefined {
  const key = nameOrId.trim().toLowerCase();
  if (Object.hasOwn(BUILTIN_THEMES, key)) return BUILTIN_THEMES[key];
  return Object.values(BUILTIN_THEMES).find((t) => t.name.toLowerCase() === key);
}
