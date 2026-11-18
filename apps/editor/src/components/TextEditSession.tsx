/**
 * Typing on the slide (D44). While a text layer is being edited, a TipTap editor sits inside
 * the layer's own box on the stage, so it inherits everything the render has: the stage
 * scale, rotations, theme variables and fonts. It copies the text plugin's box style and
 * renders paragraphs/lists with the same CSS, so the text doesn't move when editing starts.
 * The plugin's own render stays in place underneath (hidden): fed by the live preview, it
 * keeps laying the slide out, so a hug-height box grows and its stack reflows as you type.
 *
 * Same contract as every gesture (D41): each change only previews locally; leaving the
 * session commits ONE transaction (`node.update` of `props.content`), so a whole editing
 * session is one undo step. Inside the session, Ctrl+Z is TipTap's own history.
 *
 * TipTap is a separate chunk (~125 KB gzip), loaded on first use and prefetched as soon as a
 * text layer is selected (`prefetchTextEditor`), so it never weighs on startup.
 */
import type { Editor } from "@tiptap/core";
import type { TextContent } from "@veloce/core";
import { NODE_ID_ATTR } from "@veloce/renderer";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reportError, run } from "../actions.js";
import { updateNode } from "../model/commands.js";
import type { Point } from "../model/geometry.js";
import {
  type DocNode,
  fromDoc,
  normalizeContent,
  normalizeLink,
  sameContent,
  toContent,
} from "../model/rich-text-doc.js";
import { setPreview } from "../preview.js";

let editorModule: Promise<typeof import("./text-editor.js")> | null = null;
/** Loads TipTap (once). Call it early when typing is likely, e.g. a text layer got selected. */
export const prefetchTextEditor = () => {
  editorModule ??= import("./text-editor.js").catch((error: unknown) => {
    editorModule = null; // let a later attempt retry
    throw error;
  });
  return editorModule;
};

/** On the layer being edited: hides the plugin's render under the editor (styles.css). */
export const EDITING_ATTR = "data-text-editing";
const HOST_CLASS = "text-edit-host";

/** Where the caret starts: under the double-click, or everything selected (Enter). */
export type Caret = Point | "all";

/** True for events inside the editable text (the canvas leaves those to the editor). */
export const inTextEditor = (target: EventTarget | null) =>
  target instanceof Element && target.closest(`.${HOST_CLASS}`) !== null;

interface Props {
  stage: HTMLElement;
  nodeId: string;
  /** The stored content when editing started. */
  content: TextContent;
  /** For the undo label. */
  label: string;
  caret: Caret;
  /** Overlay pixels: the toolbar sits above this point (the layer's top-left on screen). */
  anchor: Point | null;
  /** Whether the layer is still in the document (checked before committing). */
  exists(): boolean;
  onExit(): void;
}

export function TextEditSession(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const [editor, setEditor] = useState<Editor | null>(null);
  // Re-render on every editor transaction: the toolbar follows selection and formatting.
  const [, setTick] = useState(0);

  useLayoutEffect(() => {
    const { stage, nodeId, content, caret, label } = latest.current;
    const layer = stage.querySelector<HTMLElement>(`[${NODE_ID_ATTR}="${CSS.escape(nodeId)}"]`);
    if (!layer) {
      latest.current.onExit();
      return;
    }
    const host = document.createElement("div");
    host.className = HOST_CLASS;
    layer.append(host);
    // Mirror the plugin's text box style (font, color, alignment…), now and whenever it changes.
    const rendered = [...layer.children].find((c) => c !== host) as HTMLElement | undefined;
    const mirror = () => {
      host.style.cssText = rendered?.style.cssText ?? "";
      Object.assign(host.style, { position: "absolute", left: "0", top: "0", zIndex: "1" });
    };
    mirror();
    const styleWatch = new MutationObserver(mirror);
    if (rendered) styleWatch.observe(rendered, { attributes: true, attributeFilter: ["style"] });

    const baseline = normalizeContent(content);
    let doc: DocNode | null = null; // null until the first change
    let frame = 0;
    const current = () => (doc ? toContent(fromDoc(doc)) : baseline);
    const preview = () => {
      frame = 0;
      setPreview([{ op: "node.update", id: nodeId, set: { props: { content: current() } } }]);
    };

    let instance: Editor | null = null;
    let ended = false;
    prefetchTextEditor()
      .then(({ createTextEditor }) => {
        if (ended) return; // the session ended while TipTap loaded
        instance = createTextEditor({
          element: host,
          content,
          onChange: (next) => {
            doc = next;
            if (!frame) frame = requestAnimationFrame(preview); // one re-layout per frame, max
          },
          onExit: () => latest.current.onExit(),
          onSelectionChange: () => setTick((t) => t + 1),
        });
        // Only now swap the render for the editor: no blank frame while loading.
        layer.setAttribute(EDITING_ATTR, "");
        if (caret === "all") {
          instance.commands.focus("all", { scrollIntoView: false });
        } else {
          const at = instance.view.posAtCoords({ left: caret.x, top: caret.y });
          instance.commands.focus(at?.pos ?? "end", { scrollIntoView: false });
        }
        setEditor(instance);
      })
      .catch((error: unknown) => {
        reportError(error);
        latest.current.onExit();
      });

    return () => {
      ended = true;
      cancelAnimationFrame(frame);
      styleWatch.disconnect();
      const next = current();
      instance?.destroy();
      host.remove();
      layer.removeAttribute(EDITING_ATTR);
      if (!doc) return; // never changed: nothing to preview or commit
      if (!sameContent(next, baseline) && latest.current.exists()) {
        const command = updateNode(nodeId, { props: { content: next } }, `Edit text "${label}"`);
        // Keep showing the edit until the server's version arrives (no flash of the old text).
        void run(command).finally(() => setPreview(null));
      } else {
        setPreview(null);
      }
    };
  }, []);

  if (!editor || !props.anchor) return null;
  return <TextToolbar editor={editor} anchor={props.anchor} />;
}

// ── Formatting toolbar ──────────────────────────────────────────────────────────────────

type Chain = ReturnType<Editor["chain"]>;

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

function TextToolbar({ editor, anchor }: { editor: Editor; anchor: Point }) {
  const [link, setLink] = useState<string | null>(null); // the link field's text, when open
  const [invalid, setInvalid] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);

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

  return (
    <div
      className="text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {MARKS.map(({ name, label, keys, icon: Icon, toggle }) => (
        <button
          key={name}
          type="button"
          className={`icon-button${editor.isActive(name) ? " is-on" : ""}`}
          aria-label={label}
          aria-pressed={editor.isActive(name)}
          data-tip={label}
          data-keys={keys}
          // Keep the focus (and the text selection) in the editor.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle(editor.chain().focus(undefined, { scrollIntoView: false })).run()}
        >
          <Icon size={15} />
        </button>
      ))}
      <button
        type="button"
        className={`icon-button${editor.isActive("link") ? " is-on" : ""}`}
        aria-label="Link"
        aria-pressed={editor.isActive("link")}
        aria-expanded={link !== null}
        data-tip="Link"
        onMouseDown={(e) => e.preventDefault()}
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
