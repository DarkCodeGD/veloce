/**
 * The deck's theme, in the inspector when nothing is selected: pick a built-in theme (each
 * card previews its background, heading font and colors), then fine-tune the palette and the
 * fonts. Every change is one `deck.setTheme` transaction (the op the AI's set_theme uses), so
 * the whole deck restyles at once and Ctrl+Z takes it back in one step. Contrast problems in
 * the palette are flagged right here, before they show up as lint warnings on slides.
 *
 * Font pickers list the deck's own fonts (files dropped on the canvas, added here, or by an
 * agent) above the bundled ones.
 */
import {
  BUILTIN_THEMES,
  BUNDLED_FONTS,
  type Deck,
  deckFontFamilies,
  fontStackFor,
  primaryFamily,
  type Theme,
} from "@veloce/core";
import { Plus, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { run } from "../actions.js";
import { uploadAll } from "../assets.js";
import { addFonts, splitImports } from "../model/asset-insert.js";
import { fromPicked, type PickedColor, pickerColor } from "../model/color.js";
import {
  builtinIdOf,
  contrastIssues,
  setThemeCommand,
  withColor,
  withFont,
} from "../model/theme-edit.js";
import { setPreview } from "../preview.js";
import { showToast } from "../toasts.js";
import { ColorPicker, ColorPopover } from "./ColorPicker.js";
import { Group, Section, SelectField } from "./fields.js";
import type { SelectOption } from "./Select.js";

/** Each font shown in itself; no hint, so long names fit the trigger. */
const FONT_OPTIONS: SelectOption[] = BUNDLED_FONTS.map((f) => ({
  value: f.stack,
  label: f.family,
  fontFamily: f.stack,
}));

export function ThemeSection({ deck }: { deck: Deck }) {
  const { theme } = deck;
  const currentId = builtinIdOf(theme);
  const fontOptions = [
    ...deckFontFamilies(deck).map(
      (family): SelectOption => ({
        value: fontStackFor(family),
        label: family,
        hint: "deck",
        fontFamily: fontStackFor(family),
      }),
    ),
    ...FONT_OPTIONS,
  ];
  const issues = contrastIssues(theme);
  const flagged = new Set(issues.flatMap((i) => i.tokens));
  const commit = (next: Theme, label: string) =>
    void run(setThemeCommand(next, label)).finally(() => setPreview(null));

  return (
    <Section title="Theme">
      <fieldset className="theme-grid">
        <legend className="sr-only">Built-in themes</legend>
        {Object.entries(BUILTIN_THEMES).map(([id, t]) => (
          <ThemeCard
            key={id}
            theme={t}
            on={id === currentId}
            onPick={() => commit(t, `Set theme "${t.name}"`)}
          />
        ))}
      </fieldset>
      {currentId === null && (
        <p className="inspector-hint">
          Customized: <strong>{theme.name}</strong>. Pick a theme above to start over.
        </p>
      )}

      <Group title="Colors">
        <ul className="theme-colors">
          {Object.entries(theme.colors).map(([name, value]) => (
            <ColorToken
              key={name}
              name={name}
              value={value}
              warn={flagged.has(name)}
              onPreview={(hex) => setPreview(setThemeCommand(withColor(theme, name, hex), "").ops)}
              onCommit={(hex) =>
                hex.toLowerCase() === value.toLowerCase()
                  ? setPreview(null)
                  : commit(withColor(theme, name, hex), `Change theme color "${name}"`)
              }
            />
          ))}
        </ul>
        {issues.length > 0 && (
          <ul className="theme-issues">
            {issues.map((issue) => (
              <li key={issue.pair}>
                <TriangleAlert size={13} aria-hidden="true" />
                <span>
                  {issue.pair} is hard to read: {issue.ratio}:1 (needs {issue.needs}:1)
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Fonts">
        {Object.entries(theme.fonts).map(([name, stack]) => {
          // The option for this stack: matched by family, so `"Acme", serif` written by an
          // agent still shows as Acme. A font that's neither bundled nor in the deck stays
          // pickable as "custom".
          const family = primaryFamily(stack).toLowerCase();
          const match = fontOptions.find((o) => primaryFamily(o.value).toLowerCase() === family);
          return (
            <SelectField
              key={name}
              label={name.charAt(0).toUpperCase() + name.slice(1)}
              value={match?.value ?? stack}
              options={
                match
                  ? fontOptions
                  : [{ value: stack, label: primaryFamily(stack), hint: "custom" }, ...fontOptions]
              }
              onCommit={(next) => {
                if (typeof next === "string" && next !== (match?.value ?? stack)) {
                  commit(withFont(theme, name, next), `Change theme font "${name}"`);
                }
              }}
            />
          );
        })}
        <AddFontButton deck={deck} />
      </Group>
    </Section>
  );
}

/** Pick font files to add to the deck (dropping them on the canvas works too). */
function AddFontButton({ deck }: { deck: Deck }) {
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    const { imported, errors } = await uploadAll(deck.id, files);
    const { fonts } = splitImports(imported);
    const notFonts = imported.length - fonts.length;
    if (notFonts > 0)
      errors.push(`${notFonts === 1 ? "1 file isn't" : `${notFonts} files aren't`} a font`);
    if (errors.length > 0) showToast({ message: errors.join("; "), tone: "error" }, 8000);
    const command = addFonts(fonts, new Set(Object.keys(deck.assets)));
    if (command && (await run(command))) {
      showToast({
        message: `${command.label.replace(/^Add /, "Added ")}: pick it above`,
        tone: "info",
      });
    }
  };
  return (
    <>
      <button
        type="button"
        className="button button-ghost add-font"
        onClick={() => input.current?.click()}
      >
        <Plus size={14} aria-hidden="true" /> Add font file…
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ""; // picking the same file again still fires
          if (files.length > 0) void add(files);
        }}
      />
    </>
  );
}

/** A built-in theme, previewed in its own colors and heading font. */
function ThemeCard({ theme, on, onPick }: { theme: Theme; on: boolean; onPick(): void }) {
  const c = theme.colors;
  return (
    <button
      type="button"
      className={`theme-card${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={onPick}
    >
      <span
        className="theme-preview"
        style={{ background: c.background, color: c.text, fontFamily: theme.fonts.heading }}
      >
        <span className="theme-aa">Aa</span>
        <span className="theme-dots">
          {[c.primary, c.secondary, c.accent].map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
        </span>
      </span>
      <span className="theme-name">{theme.name}</span>
    </button>
  );
}

/**
 * One palette color: the swatch opens the color picker (with alpha: a theme color may be
 * translucent). Dragging previews live; each finished drag, key or typed hex commits one
 * transaction.
 */
function ColorToken({
  name,
  value,
  warn,
  onPreview,
  onCommit,
}: {
  name: string;
  value: string;
  warn: boolean;
  onPreview(hex: string): void;
  onCommit(hex: string): void;
}) {
  const swatch = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const shown = pickerColor(value, value);
  const picked = (p: PickedColor) => fromPicked(value, shown.hex, p);
  return (
    <li className={`theme-color${warn ? " is-warn" : ""}`}>
      <button
        ref={swatch}
        type="button"
        className={`theme-swatch${picking ? " is-open" : ""}`}
        style={{ background: value }}
        data-tip={picking ? undefined : `Edit ${name}`}
        aria-label={`Theme color ${name}`}
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
      />
      <span className="theme-color-name">{name}</span>
      <code className="theme-color-value">{value}</code>
      {picking && (
        <ColorPopover trigger={swatch} onClose={() => setPicking(false)}>
          <ColorPicker
            label={`Theme color ${name}`}
            value={shown}
            onPreview={(p) => onPreview(picked(p))}
            onCommit={(p) => onCommit(picked(p))}
          />
        </ColorPopover>
      )}
    </li>
  );
}
