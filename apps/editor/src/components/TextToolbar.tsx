/**
 * The formatting toolbar above a text layer being typed into (D44, D61):
 *
 *   [Style ▾] | B I U S <> | [A Color ▾] [≡ Align ▾] | • 1. | 🔗
 *
 * Every control keeps the focus (and so the text selection) in the editor: buttons cancel
 * their mousedown, and the menus are plain buttons in a popup, not focus-taking widgets. So
 * the next keystroke keeps typing, and the selection stays visible while you pick. The one
 * exception is the system color picker, which needs focus; the editor gets it back on close.
 *
 * Style and alignment format whole paragraphs; color formats the selected text (or what the
 * caret types next). What the controls show is the selection's effective value: its own
 * format, else the layer's (`box`); "Mixed" when the selection disagrees. When a session
 * ends, formatting that covers the whole text moves to the layer itself (model/text-box.ts).
 */
import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { resolveColor, type Theme } from "@veloce/core";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from "lucide-react";
import {
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Point } from "../model/geometry.js";
import { DOC, normalizeLink } from "../model/rich-text-doc.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { type Align, effectiveBox, type TextBox, uniform } from "../model/text-box.js";
import { toHex6 } from "../model/theme-edit.js";
import { shortcutAttrs } from "../platform.js";
import { Swatches, tokenOptions } from "./fields.js";
import { useColorPicker } from "./useColorPicker.js";

type Chain = ReturnType<Editor["chain"]>;

/** Keep the focus (and the text selection) in the editor when a control is pressed. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const MARKS: Array<{
  name: string;
  label: string;
  keys: string;
  icon: typeof Bold;
  toggle(chain: Chain): Chain;
}> = [
  { name: "bold", label: "Bold", keys: "Mod+B", icon: Bold, toggle: (c) => c.toggleBold() },
  { name: "italic", label: "Italic", keys: "Mod+I", icon: Italic, toggle: (c) => c.toggleItalic() },
  {
    name: "underline",
    label: "Underline",
    keys: "Mod+U",
    icon: Underline,
    toggle: (c) => c.toggleUnderline(),
  },
  {
    name: "strike",
    label: "Strikethrough",
    keys: "Mod+Shift+S",
    icon: Strikethrough,
    toggle: (c) => c.toggleStrike(),
  },
  { name: "code", label: "Code", keys: "Mod+E", icon: Code, toggle: (c) => c.toggleCode() },
];

const LISTS: typeof MARKS = [
  {
    name: "bulletList",
    label: "Bulleted list",
    keys: "Mod+Shift+8",
    icon: List,
    toggle: (c) => c.toggleBulletList(),
  },
  {
    name: "orderedList",
    label: "Numbered list",
    keys: "Mod+Shift+7",
    icon: ListOrdered,
    toggle: (c) => c.toggleOrderedList(),
  },
];

const ALIGNS: Array<{ value: Align; label: string; keys: string; icon: typeof AlignLeft }> = [
  { value: "left", label: "Align left", keys: SHORTCUTS.textAlignLeft, icon: AlignLeft },
  { value: "center", label: "Align center", keys: SHORTCUTS.textAlignCenter, icon: AlignCenter },
  { value: "right", label: "Align right", keys: SHORTCUTS.textAlignRight, icon: AlignRight },
  { value: "justify", label: "Justify", keys: SHORTCUTS.textAlignJustify, icon: AlignJustify },
];

// ── What the selection looks like ───────────────────────────────────────────────────────

/** The paragraphs the selection touches (the caret's, when nothing is selected). */
function selectedParagraphs(editor: Editor): PMNode[] {
  const { selection, doc } = editor.state;
  if (selection.empty) {
    const parent = selection.$from.parent;
    return parent.type.name === DOC.paragraph ? [parent] : [];
  }
  const out: PMNode[] = [];
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name !== DOC.paragraph) return true; // a list: look inside
    out.push(node);
    return false;
  });
  return out;
}

/** The selected text's own colors (or what the caret will type); undefined = the layer's. */
function selectedColors(editor: Editor): Array<string | undefined> {
  const { selection, doc, storedMarks } = editor.state;
  const colorOf = (marks: readonly Mark[]) => {
    const color = marks.find((m) => m.type.name === DOC.color)?.attrs.color;
    return typeof color === "string" ? color : undefined;
  };
  if (selection.empty) return [colorOf(storedMarks ?? selection.$from.marks())];
  const out: Array<string | undefined> = [];
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isText) out.push(colorOf(node.marks));
  });
  return out.length > 0 ? out : [undefined];
}

/** The selection's effective style, alignment and color; undefined where it's mixed. */
export function selectionFormat(editor: Editor, box: TextBox) {
  const base = effectiveBox(box);
  const paragraphs = selectedParagraphs(editor);
  const attr = (p: PMNode, name: string) => {
    const value = p.attrs[name];
    return typeof value === "string" ? value : undefined;
  };
  return {
    style: uniform(paragraphs.map((p) => attr(p, "textStyle") ?? base.style)),
    align: uniform(paragraphs.map((p) => (attr(p, "align") as Align | undefined) ?? base.align)),
    color: uniform(selectedColors(editor).map((c) => c ?? base.color)),
  };
}

/** A color as the screen shows it: a `$color.*` token (at its opacity) resolved through the theme. */
function swatchColor(theme: Theme, color: string | undefined): string | undefined {
  return color === undefined ? undefined : resolveColor(theme, color);
}

// ── The toolbar ─────────────────────────────────────────────────────────────────────────

type MenuName = "style" | "color" | "align";

interface Props {
  editor: Editor;
  /** Overlay pixels: the toolbar sits above this point (the layer's top-left on screen). */
  anchor: Point;
  theme: Theme;
  /** The layer's own style/color/alignment: what unformatted text shows. */
  box: TextBox;
  /**
   * Esc while typing calls this first: it closes an open menu (and returns true) instead of
   * ending the session.
   */
  escapeTrap: MutableRefObject<(() => boolean) | null>;
}

export function TextToolbar({ editor, anchor, theme, box, escapeTrap }: Props) {
  const [link, setLink] = useState<string | null>(null); // the link field's text, when open
  const [invalid, setInvalid] = useState(false);
  const [menu, setMenu] = useState<MenuName | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const format = selectionFormat(editor, box);

  /** Run a command on the editor, keeping (or giving back) its focus. */
  const apply = (command: (chain: Chain) => Chain) =>
    command(editor.chain().focus(undefined, { scrollIntoView: false })).run();
  const pick = (command: (chain: Chain) => Chain) => {
    apply(command);
    setMenu(null);
  };
  const toggleMenu = (name: MenuName) => setMenu((open) => (open === name ? null : name));

  // Esc closes the open menu first; the session ends on the next one.
  useEffect(() => {
    escapeTrap.current = () => {
      if (!menu) return false;
      setMenu(null);
      return true;
    };
    return () => {
      escapeTrap.current = null;
    };
  }, [escapeTrap, menu]);

  // A press anywhere outside the toolbar closes the menu (in the text, too: you're typing).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && root.current?.contains(e.target))) setMenu(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  const linkOpen = link !== null;
  useEffect(() => {
    if (linkOpen) linkInput.current?.select(); // once, when the field opens
  }, [linkOpen]);

  const closeLink = () => {
    setLink(null);
    setInvalid(false);
    editor.commands.focus(undefined, { scrollIntoView: false });
  };
  const applyLink = () => {
    const text = link?.trim() ?? "";
    const href = text ? normalizeLink(text) : null;
    // Validate before building the chain: TipTap's `focus()` schedules the editor's focus as
    // soon as it's chained, even if the chain never runs. Building it first made a refused
    // link hand the focus back to the editor a frame later, so the corrected address was
    // typed over the selected text.
    if (text && !href) return setInvalid(true);
    const chain = editor.chain().focus(undefined, { scrollIntoView: false });
    if (!href) {
      chain.extendMarkRange("link").unsetLink().run();
      return closeLink();
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: insert the address itself as the link text.
      chain.insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
    closeLink();
  };

  const toggles = (items: typeof MARKS) =>
    items.map(({ name, label, keys, icon: Icon, toggle }) => (
      <button
        key={name}
        type="button"
        className={`icon-button${editor.isActive(name) ? " is-on" : ""}`}
        aria-label={label}
        aria-pressed={editor.isActive(name)}
        data-tip={label}
        {...shortcutAttrs(keys)}
        onMouseDown={keepFocus}
        onClick={() => apply(toggle)}
      >
        <Icon size={15} />
      </button>
    ));

  const styles = tokenOptions(theme, "text");
  const styleName = format.style ? format.style.replace(/^\$text\./, "") : "Mixed";
  const alignNow = ALIGNS.find((a) => a.value === format.align);
  const AlignIcon = alignNow?.icon ?? AlignLeft;

  return (
    <div
      ref={root}
      className="text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Text style (whole paragraphs) ── */}
      <ToolbarMenu
        open={menu === "style"}
        onToggle={() => toggleMenu("style")}
        label={`Text style: ${styleName}`}
        tip="Text style"
        className="text-style-trigger"
        trigger={
          <>
            <span className="text-style-name">{styleName}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </>
        }
      >
        <div className="text-style-list" role="menu" aria-label="Text styles">
          {styles.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={format.style === o.value}
              className={`text-style-option${format.style === o.value ? " is-on" : ""}`}
              onMouseDown={keepFocus}
              onClick={() => pick((c) => c.updateAttributes(DOC.paragraph, { textStyle: o.value }))}
            >
              <span style={{ fontFamily: o.fontFamily }}>{o.label}</span>
              <span className="hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </ToolbarMenu>
      <span className="toolbar-divider" aria-hidden="true" />

      {toggles(MARKS)}
      <span className="toolbar-divider" aria-hidden="true" />

      {/* ── Text color (the selected text) ── */}
      <ToolbarMenu
        open={menu === "color"}
        onToggle={() => toggleMenu("color")}
        label={`Text color: ${format.color?.replace(/^\$color\./, "") ?? "Mixed"}`}
        tip="Text color"
        className="icon-button text-color-trigger"
        trigger={
          <>
            <span className="text-color-glyph" aria-hidden="true">
              A
            </span>
            <span
              className={`text-color-bar${format.color ? "" : " is-mixed"}`}
              style={{ background: swatchColor(theme, format.color) }}
              aria-hidden="true"
            />
          </>
        }
      >
        <ColorMenu
          theme={theme}
          value={format.color}
          onPreview={(color) => editor.chain().setMark(DOC.color, { color }).run()}
          onPick={(color) => pick((c) => c.setMark(DOC.color, { color }))}
        />
      </ToolbarMenu>

      {/* ── Alignment (whole paragraphs) ── */}
      <ToolbarMenu
        open={menu === "align"}
        onToggle={() => toggleMenu("align")}
        label={`Alignment: ${alignNow?.label.replace(/^Align /, "") ?? "Mixed"}`}
        tip="Alignment"
        className="icon-button"
        trigger={<AlignIcon size={15} />}
      >
        <div className="text-align-row" role="menu" aria-label="Alignment">
          {ALIGNS.map(({ value, label, keys, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={format.align === value}
              aria-label={label}
              className={`icon-button${format.align === value ? " is-on" : ""}`}
              data-tip={label}
              {...shortcutAttrs(keys)}
              onMouseDown={keepFocus}
              onClick={() => pick((c) => c.updateAttributes(DOC.paragraph, { align: value }))}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </ToolbarMenu>
      <span className="toolbar-divider" aria-hidden="true" />

      {toggles(LISTS)}
      <button
        type="button"
        className={`icon-button${editor.isActive("link") ? " is-on" : ""}`}
        aria-label="Link"
        aria-pressed={editor.isActive("link")}
        aria-expanded={link !== null}
        data-tip="Link"
        onMouseDown={keepFocus}
        onClick={() =>
          link === null ? setLink(String(editor.getAttributes("link").href ?? "")) : closeLink()
        }
      >
        <LinkIcon size={15} />
      </button>
      {link !== null && (
        <input
          ref={linkInput}
          className="text-toolbar-link"
          aria-label="Link address"
          aria-invalid={invalid}
          placeholder="https://… (empty removes the link)"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation(); // closes the field, not the editing session
              closeLink();
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * A toolbar button with a popup. The popup opens above the toolbar (the text being edited is
 * below it), or below when there's no room above in the canvas.
 */
function ToolbarMenu({
  open,
  onToggle,
  label,
  tip,
  className,
  trigger,
  children,
}: {
  open: boolean;
  onToggle(): void;
  label: string;
  tip: string;
  className: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    if (!open) return setBelow(false);
    const el = popup.current;
    const canvas = el?.closest(".editor-canvas")?.getBoundingClientRect();
    if (el && canvas) setBelow(el.getBoundingClientRect().top < canvas.top);
  }, [open]);
  return (
    <div className="toolbar-menu">
      <button
        type="button"
        className={`${className}${open ? " is-open" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : tip}
        onMouseDown={keepFocus}
        onClick={onToggle}
      >
        {trigger}
      </button>
      {open && (
        <div ref={popup} className={`toolbar-popup${below ? " is-below" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Theme colors first; any other color from the system picker. */
function ColorMenu({
  theme,
  value,
  onPreview,
  onPick,
}: {
  theme: Theme;
  value: string | undefined;
  /** Dragging in the system picker: recolor live (no focus change, the picker is open). */
  onPreview(color: string): void;
  onPick(color: string): void;
}) {
  const shown = swatchColor(theme, value);
  const hex = (shown && toHex6(shown)) ?? "#000000";
  const picker = useColorPicker(hex, onPick, onPreview);
  const custom = value !== undefined && !value.startsWith("$");
  return (
    <div className="text-color-menu">
      <Swatches theme={theme} label="Text color" value={value} onPick={onPick} keepFocus />
      {/* The system picker needs the focus; picking hands it back to the text. */}
      <label className={`text-color-custom${custom ? " is-on" : ""}`}>
        <span className="text-color-custom-chip" style={{ background: custom ? shown : undefined }}>
          <input
            ref={picker}
            type="color"
            className="picker-input"
            aria-label="Custom text color"
          />
        </span>
        Custom…
      </label>
    </div>
  );
}
