/**
 * The deck's theme, in the inspector when nothing is selected: pick a built-in theme (each
 * card previews its background, heading font and colors), then fine-tune the palette and the
 * fonts. Every change is one `deck.setTheme` transaction (the op the AI's set_theme uses), so
 * the whole deck restyles at once and Ctrl+Z takes it back in one step. Contrast problems in
 * the palette are flagged right here, before they show up as lint warnings on slides.
 */
import {
  BUILTIN_THEMES,
  BUNDLED_FONTS,
  bundledFont,
  primaryFamily,
  type Theme,
} from "@veloce/core";
import { TriangleAlert } from "lucide-react";

import { run } from "../actions.js";
import {
  builtinIdOf,
  contrastIssues,
  setThemeCommand,
  toHex6,
  withColor,
  withFont,
} from "../model/theme-edit.js";
import { setPreview } from "../preview.js";
import { Group, Section, SelectField } from "./fields.js";
import type { SelectOption } from "./Select.js";
import { useColorPicker } from "./useColorPicker.js";

/** Each font shown in itself; no hint, so long names fit the trigger. */
const FONT_OPTIONS: SelectOption[] = BUNDLED_FONTS.map((f) => ({
  value: f.stack,
  label: f.family,
  fontFamily: f.stack,
}));

export function ThemeSection({ theme }: { theme: Theme }) {
  const currentId = builtinIdOf(theme);
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
        {Object.entries(theme.fonts).map(([name, stack]) => (
          <SelectField
            key={name}
            label={name.charAt(0).toUpperCase() + name.slice(1)}
            value={stack}
            options={
              bundledFont(stack)
                ? FONT_OPTIONS
                : // A font the AI (or a file) set that isn't bundled: keep it pickable.
                  [{ value: stack, label: primaryFamily(stack), hint: "custom" }, ...FONT_OPTIONS]
            }
            onCommit={(next) => {
              if (typeof next === "string" && next !== stack) {
                commit(withFont(theme, name, next), `Change theme font "${name}"`);
              }
            }}
          />
        ))}
      </Group>
    </Section>
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
 * One palette color: the swatch opens the system color picker. Dragging in the picker
 * previews live; closing it commits one transaction.
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
  // The system picker has no alpha: editing a translucent token makes it opaque.
  const hex6 = toHex6(value) ?? "#000000";
  const input = useColorPicker(hex6, onCommit, onPreview);
  return (
    <li className={`theme-color${warn ? " is-warn" : ""}`}>
      <label className="theme-swatch" style={{ background: value }} data-tip={`Edit ${name}`}>
        <span className="sr-only">{`Theme color ${name}`}</span>
        <input ref={input} type="color" className="picker-input" />
      </label>
      <span className="theme-color-name">{name}</span>
      <code className="theme-color-value">{value}</code>
    </li>
  );
}
