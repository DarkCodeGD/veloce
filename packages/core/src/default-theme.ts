import type { Theme } from "./schema/theme.js";

/**
 * The built-in starting theme: clean, light, high-contrast.
 * Every token name here is part of the documented vocabulary the AI is taught,
 * so themes should keep these names (they may add more).
 */
export const DEFAULT_THEME: Theme = {
  name: "Veloce Light",
  colors: {
    background: "#ffffff",
    surface: "#f4f5f7",
    text: "#111318",
    muted: "#5b6170",
    border: "#e3e5ea",
    primary: "#4f46e5",
    "on-primary": "#ffffff",
    secondary: "#0ea5e9",
    accent: "#f59e0b",
    success: "#16a34a",
    danger: "#dc2626",
  },
  fonts: {
    heading: "Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  text: {
    display: { font: "heading", size: 120, weight: 800, lineHeight: 1.05, letterSpacing: -0.02 },
    h1: { font: "heading", size: 80, weight: 700, lineHeight: 1.1, letterSpacing: -0.01 },
    h2: { font: "heading", size: 56, weight: 700, lineHeight: 1.15 },
    h3: { font: "heading", size: 40, weight: 600, lineHeight: 1.2 },
    body: { font: "body", size: 32, weight: 400, lineHeight: 1.4 },
    small: { font: "body", size: 24, weight: 400, lineHeight: 1.4 },
    caption: { font: "body", size: 20, weight: 500, lineHeight: 1.3, letterSpacing: 0.02 },
    code: { font: "mono", size: 26, weight: 400, lineHeight: 1.5 },
  },
  space: { xs: 8, sm: 16, md: 32, lg: 64, xl: 96, xxl: 160 },
  radius: { sm: 8, md: 16, lg: 32, full: 9999 },
  shadow: {
    sm: { x: 0, y: 2, blur: 6, color: "#0000001a" },
    md: { x: 0, y: 8, blur: 24, color: "#00000026" },
    lg: { x: 0, y: 24, blur: 64, color: "#00000033" },
  },
};
