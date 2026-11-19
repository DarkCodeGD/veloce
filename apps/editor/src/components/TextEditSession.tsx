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
import type { TextContent, Theme } from "@veloce/core";
import { NODE_ID_ATTR } from "@veloce/renderer";
import { useLayoutEffect, useRef, useState } from "react";
import { reportError, run } from "../actions.js";
import { updateNode } from "../model/commands.js";
import type { Point } from "../model/geometry.js";
import { type DocNode, fromDoc, toContent, toDoc } from "../model/rich-text-doc.js";
import { samePatch, type TextBox, textPatch } from "../model/text-box.js";
import { setPreview } from "../preview.js";
import { TextToolbar } from "./TextToolbar.js";

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
  /** The layer's own style/color/alignment when editing started (what plain text shows). */
  box: TextBox;
  theme: Theme;
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
  /** Set by the toolbar while a menu is open: Esc closes that instead of ending typing. */
  const escapeTrap = useRef<(() => boolean) | null>(null);

  useLayoutEffect(() => {
    const { stage, nodeId, content, caret, label, box } = latest.current;
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

    let doc: DocNode | null = null; // null until the first change
    let frame = 0;
    // Typing previews the text as typed: same look as the final patch, without moving
    // formatting to the layer mid-session (the toolbar reads paragraphs against `box`).
    const preview = () => {
      frame = 0;
      if (!doc) return;
      const typed = toContent(fromDoc(doc));
      setPreview([{ op: "node.update", id: nodeId, set: { props: { content: typed } } }]);
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
          onExit: () => {
            if (escapeTrap.current?.()) return; // Esc closed a toolbar menu
            latest.current.onExit();
          },
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
      instance?.destroy();
      host.remove();
      layer.removeAttribute(EDITING_ATTR);
      if (!doc) return; // never changed: nothing to preview or commit
      // What's stored: formatting covering the whole text moves to the layer (D61). Compared
      // with the same treatment of the untouched text, so a no-op edit sends nothing.
      const next = textPatch(fromDoc(doc), box);
      const baseline = textPatch(fromDoc(toDoc(content)), box);
      if (!samePatch(next, baseline) && latest.current.exists()) {
        const command = updateNode(nodeId, { props: next }, `Edit text "${label}"`);
        // Keep showing the edit until the server's version arrives (no flash of the old text).
        void run(command).finally(() => setPreview(null));
      } else {
        setPreview(null);
      }
    };
  }, []);

  if (!editor || !props.anchor) return null;
  return (
    <TextToolbar
      editor={editor}
      anchor={props.anchor}
      theme={props.theme}
      box={props.box}
      escapeTrap={escapeTrap}
    />
  );
}
