/**
 * Theme styles (D78): the theme's text styles and its spacing, radius and shadow scales, the
 * part of the theme too big for the inspector (which keeps colors and fonts).
 *
 * Everything edits a draft, shown by the dialog's own samples (and on the canvas behind it, for
 * any part not covered); Save writes it as one
 * `deck.setTheme` (one undo step), merged by group onto the deck's current theme so an
 * agent's concurrent changes to other groups survive. Tokens can be added (as agents can) and
 * removed while nothing in the deck uses them. Fields are the inspector's own (scrub, nudge,
 * Enter commits, Esc reverts the field, not the dialog).
 */
import { type Deck, primaryFamily, type Shadow, type TextStyle, type Theme } from "@veloce/core";
import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { run } from "../actions.js";
import { shadowColor } from "../model/frame-style.js";
import { setThemeCommand } from "../model/theme-edit.js";
import {
  CASES,
  emToPercent,
  mergeDraft,
  newTokenValue,
  percentToEm,
  type StyleGroup,
  textStyleSummary,
  tokenNameError,
  tokenUses,
  WEIGHTS,
  withShadow,
  withTextStyle,
  withToken,
} from "../model/theme-styles.js";
import { setPreview } from "../preview.js";
import { Dialog } from "./Dialog.js";
import { ColorField, NumberField, SelectField } from "./fields.js";

const TABS: ReadonlyArray<readonly [StyleGroup, string]> = [
  ["text", "Text styles"],
  ["space", "Spacing"],
  ["radius", "Radius"],
  ["shadow", "Shadows"],
];

/** What a token is called in buttons and messages, per group. */
const NOUN: Record<StyleGroup, string> = {
  text: "text style",
  space: "spacing step",
  radius: "radius",
  shadow: "shadow",
};

interface PaneProps {
  deck: Deck;
  draft: Theme;
  setDraft(theme: Theme): void;
}

export function ThemeStylesDialog({ deck, onClose }: { deck: Deck; onClose(): void }) {
  /** The theme when the dialog opened: what "changed" is measured against. */
  const [original] = useState(deck.theme);
  const [draft, setDraft] = useState(deck.theme);
  const [tab, setTab] = useState<StyleGroup>("text");
  const tabIds = useId();
  // Memoized: it feeds the preview, and the preview re-renders App (and so this dialog). A new
  // object every render would set the preview again, forever.
  const saved = useMemo(
    () => mergeDraft(original, draft, deck.theme),
    [original, draft, deck.theme],
  );

  // The canvas shows the draft as it's edited; closing (saved or not) drops the preview.
  useEffect(() => {
    setPreview(saved ? setThemeCommand(saved, "").ops : null);
  }, [saved]);
  useEffect(() => () => setPreview(null), []);

  const save = () => {
    if (!saved) return onClose();
    void run(setThemeCommand(saved, "Edit theme styles")).then((ok) => ok && onClose());
  };

  const pane: PaneProps = { deck, draft, setDraft };
  return (
    <Dialog
      title="Theme styles"
      className="theme-styles-dialog"
      fieldKeys="field"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!saved}>
            Save
          </button>
        </>
      }
    >
      <div className="dialog-tabs" role="tablist" aria-label="Theme styles">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${tabIds}-${id}`}
            aria-selected={tab === id}
            aria-controls={`${tabIds}-panel`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="theme-styles-panel"
        role="tabpanel"
        id={`${tabIds}-panel`}
        aria-labelledby={`${tabIds}-${tab}`}
      >
        {tab === "text" && <TextStylesPane {...pane} />}
        {(tab === "space" || tab === "radius") && <ScalePane key={tab} group={tab} {...pane} />}
        {tab === "shadow" && <ShadowsPane {...pane} />}
      </div>
    </Dialog>
  );
}

// ── Text styles ─────────────────────────────────────────────────────────────────────────

function TextStylesPane({ deck, draft, setDraft }: PaneProps) {
  const names = Object.keys(draft.text);
  const [selected, setSelected] = useState(names[0] ?? "");
  const name = draft.text[selected] ? selected : (names[0] ?? "");
  const style = draft.text[name];
  const set = (patch: Parameters<typeof withTextStyle>[2]) =>
    setDraft(withTextStyle(draft, name, patch));
  const fontOptions = Object.entries(draft.fonts).map(([token, stack]) => ({
    value: token,
    label: token.charAt(0).toUpperCase() + token.slice(1),
    hint: primaryFamily(stack),
    fontFamily: stack,
  }));

  return (
    <div className="token-editor">
      <TokenList
        group="text"
        names={names}
        selected={name}
        onSelect={setSelected}
        draft={draft}
        setDraft={setDraft}
        onAdded={setSelected}
        render={(token) => {
          const s = draft.text[token];
          return (
            <>
              <span className="token-aa" style={s && sampleStyle(draft, s, 22)}>
                Aa
              </span>
              <span className="token-text">
                <span className="token-name">{token}</span>
                <span className="token-hint">{s && textStyleSummary(s)}</span>
              </span>
            </>
          );
        }}
      />
      {style && (
        <div className="token-fields">
          <p className="text-sample" style={sampleStyle(draft, style, 56)}>
            The quick brown fox
          </p>
          <SelectField
            label="Font"
            value={style.font}
            options={fontOptions}
            onCommit={(v) => typeof v === "string" && set({ font: v })}
          />
          <NumberField
            label="Size"
            value={style.size}
            min={1}
            max={2000}
            suffix="px"
            required
            onCommit={(v) => typeof v === "number" && set({ size: v })}
          />
          <SelectField
            label="Weight"
            value={String(style.weight)}
            options={weightOptions(style.weight)}
            onCommit={(v) => typeof v === "string" && set({ weight: Number(v) })}
          />
          <NumberField
            label="Line height"
            value={style.lineHeight}
            min={0.5}
            max={10}
            step={0.05}
            suffix="×"
            required
            onCommit={(v) => typeof v === "number" && set({ lineHeight: v })}
          />
          <NumberField
            label="Letter spacing"
            value={emToPercent(style.letterSpacing)}
            placeholder="0"
            min={-100}
            max={100}
            step={0.5}
            suffix="%"
            onCommit={(v) =>
              set({ letterSpacing: typeof v === "number" && v !== 0 ? percentToEm(v) : null })
            }
          />
          <SelectField
            label="Case"
            value={style.transform}
            options={CASES.map(([value, label]) => ({ value, label }))}
            defaultValue="none"
            onCommit={(v) =>
              set({ transform: typeof v === "string" ? (v as TextStyle["transform"]) : null })
            }
          />
          <RemoveToken group="text" name={name} deck={deck} draft={draft} setDraft={setDraft} />
        </div>
      )}
    </div>
  );
}

/** A text style rendered as itself, its size capped so big headings fit the dialog. */
function sampleStyle(theme: Theme, style: TextStyle, maxSize: number) {
  return {
    fontFamily: theme.fonts[style.font],
    fontSize: Math.min(style.size, maxSize),
    fontWeight: style.weight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textTransform: style.transform,
  } as const;
}

/** The weight menu; an in-between weight an agent set (450) stays listed as itself. */
function weightOptions(current: number) {
  const named = WEIGHTS.map(([w, label]) => ({ value: String(w), label, hint: String(w) }));
  return WEIGHTS.some(([w]) => w === current)
    ? named
    : [{ value: String(current), label: String(current) }, ...named];
}

// ── Spacing and radius ──────────────────────────────────────────────────────────────────

function ScalePane({ group, deck, draft, setDraft }: PaneProps & { group: "space" | "radius" }) {
  const tokens = draft[group];
  return (
    <div className="scale-pane">
      <p className="dialog-hint">
        {group === "space"
          ? "Gaps and padding pick from these steps, so the whole deck keeps one rhythm."
          : "Corner radii for frames and shapes."}
      </p>
      <ul className="scale-list">
        {Object.entries(tokens).map(([name, value]) => (
          <li key={name} className="scale-row">
            <NumberField
              label={name}
              value={value}
              min={0}
              max={10_000}
              suffix="px"
              required
              onCommit={(v) => typeof v === "number" && setDraft(withToken(draft, group, name, v))}
            />
            <span className="scale-swatch" aria-hidden="true">
              {group === "space" ? (
                <span className="space-bar" style={{ width: `${Math.min(100, value / 1.6)}%` }} />
              ) : (
                <span className="radius-box" style={{ borderTopLeftRadius: Math.min(value, 40) }} />
              )}
            </span>
            <RemoveToken
              group={group}
              name={name}
              deck={deck}
              draft={draft}
              setDraft={setDraft}
              icon
            />
          </li>
        ))}
      </ul>
      <AddToken group={group} draft={draft} setDraft={setDraft} />
    </div>
  );
}

// ── Shadows ─────────────────────────────────────────────────────────────────────────────

function ShadowsPane({ deck, draft, setDraft }: PaneProps) {
  const names = Object.keys(draft.shadow);
  const [selected, setSelected] = useState(names[0] ?? "");
  const name = draft.shadow[selected] ? selected : (names[0] ?? "");
  const shadow = draft.shadow[name];
  const set = (patch: Parameters<typeof withShadow>[2]) => setDraft(withShadow(draft, name, patch));
  const value = (key: "x" | "y" | "blur") => (v: unknown) =>
    typeof v === "number" && set({ [key]: v });

  return (
    <div className="token-editor">
      <TokenList
        group="shadow"
        names={names}
        selected={name}
        onSelect={setSelected}
        draft={draft}
        setDraft={setDraft}
        onAdded={setSelected}
        render={(token) => (
          <>
            <span className="shadow-tile" style={shadowTile(draft, draft.shadow[token])} />
            <span className="token-text">
              <span className="token-name">{token}</span>
              <span className="token-hint">
                {draft.shadow[token] &&
                  `${draft.shadow[token].y}px · blur ${draft.shadow[token].blur}`}
              </span>
            </span>
          </>
        )}
      />
      {shadow && (
        <div className="token-fields">
          <div className="shadow-sample" style={{ background: draft.colors.background }}>
            <span className="shadow-card" style={shadowTile(draft, shadow)} />
          </div>
          <NumberField label="X" value={shadow.x} suffix="px" required onCommit={value("x")} />
          <NumberField label="Y" value={shadow.y} suffix="px" required onCommit={value("y")} />
          <NumberField
            label="Blur"
            value={shadow.blur}
            min={0}
            suffix="px"
            required
            onCommit={value("blur")}
          />
          <NumberField
            label="Spread"
            value={shadow.spread}
            placeholder="0"
            suffix="px"
            onCommit={(v) => set({ spread: typeof v === "number" && v !== 0 ? v : null })}
          />
          <ColorField
            label="Color"
            value={shadow.color}
            theme={draft}
            required
            onCommit={(v) => {
              const hex = shadowColor(draft, v);
              if (hex) set({ color: hex });
            }}
          />
          <RemoveToken group="shadow" name={name} deck={deck} draft={draft} setDraft={setDraft} />
        </div>
      )}
    </div>
  );
}

/** A card wearing a shadow, on the theme's surface color. */
function shadowTile(theme: Theme, shadow: Shadow | undefined) {
  if (!shadow) return undefined;
  const { x, y, blur, spread = 0, color } = shadow;
  return {
    background: theme.colors.surface ?? "#ffffff",
    boxShadow: `${x}px ${y}px ${blur}px ${spread}px ${color}`,
  };
}

// ── Shared: the token list, adding and removing ─────────────────────────────────────────

function TokenList({
  group,
  names,
  selected,
  onSelect,
  render,
  draft,
  setDraft,
  onAdded,
}: {
  group: StyleGroup;
  names: string[];
  selected: string;
  onSelect(name: string): void;
  render(name: string): ReactNode;
  draft: Theme;
  setDraft(theme: Theme): void;
  onAdded(name: string): void;
}) {
  return (
    <div className="token-list">
      <ul aria-label={`${NOUN[group]}s`}>
        {names.map((token) => (
          <li key={token}>
            <button
              type="button"
              className="token-item"
              aria-pressed={token === selected}
              onClick={() => onSelect(token)}
            >
              {render(token)}
            </button>
          </li>
        ))}
      </ul>
      <AddToken group={group} draft={draft} setDraft={setDraft} from={selected} onAdded={onAdded} />
    </div>
  );
}

/** "+ Add …": a name field that adds a token (a copy of `from`, if given). */
function AddToken({
  group,
  draft,
  setDraft,
  from,
  onAdded,
}: {
  group: StyleGroup;
  draft: Theme;
  setDraft(theme: Theme): void;
  from?: string;
  onAdded?(name: string): void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (!adding) {
    return (
      <button
        type="button"
        className="button button-ghost token-add"
        onClick={() => setAdding(true)}
      >
        <Plus size={14} aria-hidden="true" /> Add {NOUN[group]}
      </button>
    );
  }
  const add = () => {
    const trimmed = name.trim();
    const problem = tokenNameError(draft, group, trimmed);
    if (problem) return setError(problem);
    setDraft(withToken(draft, group, trimmed, newTokenValue(draft, group, from)));
    onAdded?.(trimmed);
    setAdding(false);
    setName("");
    setError(null);
  };
  return (
    <div className="token-add-form">
      <label htmlFor={id} className="sr-only">
        New {NOUN[group]} name
      </label>
      <input
        id={id}
        type="text"
        className="token-add-input"
        value={name}
        placeholder="Name, e.g. quote"
        spellCheck={false}
        // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to add
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") setAdding(false);
        }}
      />
      <button type="button" className="button" onClick={add}>
        Add
      </button>
      {error && (
        <p className="dialog-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Remove a token, unless the deck uses it (removing it would leave broken references). */
function RemoveToken({
  group,
  name,
  deck,
  draft,
  setDraft,
  icon,
}: {
  group: StyleGroup;
  name: string;
  deck: Deck;
  draft: Theme;
  setDraft(theme: Theme): void;
  icon?: boolean;
}) {
  const uses = useMemo(() => tokenUses(deck, group, name), [deck, group, name]);
  const label = `Remove ${NOUN[group]} "${name}"`;
  const why = uses > 0 ? `Used ${uses === 1 ? "once" : `${uses} times`} in this deck` : undefined;
  const remove = () => setDraft(withToken(draft, group, name, null));
  return icon ? (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      data-tip={why ?? "Remove"}
      disabled={uses > 0}
      onClick={remove}
    >
      <Trash2 size={14} />
    </button>
  ) : (
    <div className="token-remove">
      <button type="button" className="button button-danger" disabled={uses > 0} onClick={remove}>
        <Trash2 size={14} aria-hidden="true" /> {label}
      </button>
      {why && <span className="dialog-hint">{why}: change those layers first.</span>}
    </div>
  );
}
