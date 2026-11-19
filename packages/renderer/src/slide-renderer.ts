/**
 * SlideRenderer: draws one slide of a deck into a stage element and keeps it in sync.
 *
 * Rendering is incremental. Core's ops copy only the path to what changed (structural sharing),
 * so when `render()` sees the same node object as last time (and the same parent layout), that
 * whole subtree is untouched and skipped. Element instances survive moves and prop updates:
 * the renderer calls `update(props)` instead of remounting, so plugins keep their state.
 *
 * Plugins are isolated from each other: if one throws, its box shows an error placeholder and
 * the rest of the slide still renders.
 */
import {
  type Deck,
  type ElementNode,
  type FrameNode,
  findSlide,
  type Layout,
  type Node,
  type Slide,
  type SlideMeasurement,
  walkNodes,
} from "@veloce/core";
import type { ElementContext, ElementInstance, PluginRegistry } from "@veloce/plugin-api";
import { cssSlideBackground } from "@veloce/plugin-api";
import {
  applyCss,
  frameLayoutCss,
  frameStyleCss,
  nodeBoxCss,
  type ResolvedSizing,
} from "./layout.js";
import { measureSlide } from "./measure.js";
import { applyTheme } from "./theme.js";

export interface SlideRendererOptions {
  registry: PluginRegistry;
  /** Asset ID → URL the browser can load. */
  assetUrl(assetId: string): string;
  /** Called when a plugin throws (mount/update/seek/dispose). Default: `console.error`. */
  onPluginError?(error: unknown, info: { nodeId: string; type: string; phase: string }): void;
}

interface Mounted {
  node: Node;
  parentLayout: Layout | null;
  el: HTMLElement;
  /** Element nodes only. Undefined when the plugin is missing or failed to mount. */
  instance?: ElementInstance | undefined;
}

export const NODE_ID_ATTR = "data-node-id";

export class SlideRenderer {
  readonly #stage: HTMLElement;
  readonly #options: SlideRendererOptions;
  readonly #ctx: ElementContext;
  readonly #mounted = new Map<string, Mounted>();
  #slide: Slide | null = null;
  #theme: Deck["theme"] | null = null;
  #time = 0;
  #disposed = false;

  /** `stage` is an empty element the renderer owns; it's sized to the deck's stage. */
  constructor(stage: HTMLElement, options: SlideRendererOptions) {
    this.#stage = stage;
    this.#options = options;
    this.#ctx = { assetUrl: (id) => options.assetUrl(id) };
    stage.classList.add("v-stage");
    // The root frame is absolutely positioned against the stage.
    if (!stage.style.position) stage.style.position = "relative";
  }

  get stage(): HTMLElement {
    return this.#stage;
  }

  get slideId(): string | null {
    return this.#slide?.id ?? null;
  }

  /** Render `slideId` of `deck`. Cheap to call on every change: unchanged nodes are skipped. */
  render(deck: Deck, slideId: string): void {
    if (this.#disposed) throw new Error("SlideRenderer was disposed");
    const slide = findSlide(deck, slideId)?.slide ?? null;
    const stage = this.#stage;
    stage.style.width = `${deck.stage.width}px`;
    stage.style.height = `${deck.stage.height}px`;
    stage.style.overflow = "hidden";
    if (deck.theme !== this.#theme) {
      applyTheme(stage, deck.theme);
      this.#theme = deck.theme;
    }
    if (!slide) {
      this.#clear();
      return;
    }
    if (slide === this.#slide) return;
    stage.style.background = cssSlideBackground(
      slide.background ?? "$color.background",
      this.#ctx.assetUrl,
    );

    // Dispose nodes that are gone *before* mounting new ones, so heavy plugins (WebGL…) free
    // their resources first. IDs are unique per deck, so an ID still present is the same node.
    const live = new Set<string>();
    for (const { node } of walkNodes(slide.root)) live.add(node.id);
    for (const [id, mounted] of this.#mounted) {
      if (!live.has(id)) this.#disposeOne(id, mounted);
    }
    const rootEl = this.#renderNode(slide.root, null);
    if (stage.firstChild !== rootEl) stage.prepend(rootEl);
    this.#slide = slide;
  }

  /** Show every element as it looks `time` seconds into the slide (golden rule #3). */
  seek(time: number): void {
    this.#time = time;
    for (const [id, m] of this.#mounted) {
      if (m.instance && m.node.kind === "element")
        this.#guard(id, m.node.type, "seek", () => m.instance?.seek(time));
    }
  }

  /** Resolves when fonts and images on the stage have loaded, so measurements are final. */
  async ready(): Promise<void> {
    const doc = this.#stage.ownerDocument;
    await doc.fonts?.ready;
    const images = [...this.#stage.querySelectorAll("img")];
    await Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => {}))));
  }

  /** Bounds, overflow and text colors of every visible node (needs a real browser layout). */
  measure(): SlideMeasurement | null {
    if (!this.#slide) return null;
    const els = new Map<string, HTMLElement>();
    for (const [id, m] of this.#mounted) els.set(id, m.el);
    return measureSlide(this.#stage, this.#slide.id, els);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#clear();
    this.#disposed = true;
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────

  #clear(): void {
    for (const [id, mounted] of this.#mounted) this.#disposeOne(id, mounted);
    this.#slide = null;
  }

  #renderNode(node: Node, parentLayout: Layout | null): HTMLElement {
    let m = this.#mounted.get(node.id);
    if (m && !sameKind(m.node, node)) {
      this.#disposeOne(node.id, m);
      m = undefined;
    }
    if (m && m.node === node && m.parentLayout === parentLayout) {
      return m.el; // untouched subtree (structural sharing): nothing to do
    }
    if (!m) {
      const el = this.#stage.ownerDocument.createElement("div");
      el.setAttribute(NODE_ID_ATTR, node.id);
      m = { node, parentLayout, el };
      this.#mounted.set(node.id, m);
      this.#style(m, node, parentLayout);
      if (node.kind === "element") this.#mountElement(m, node);
    } else {
      const previous = m.node;
      if (previous !== node || m.parentLayout !== parentLayout) this.#style(m, node, parentLayout);
      if (node.kind === "element" && previous.kind === "element" && previous.props !== node.props) {
        const instance = m.instance;
        if (instance) this.#guard(node.id, node.type, "update", () => instance.update(node.props));
      }
    }
    m.node = node;
    m.parentLayout = parentLayout;
    if (node.kind === "frame") this.#renderChildren(m.el, node);
    return m.el;
  }

  #renderChildren(el: HTMLElement, frame: FrameNode): void {
    frame.children.forEach((child, i) => {
      const childEl = this.#renderNode(child, frame.layout);
      if (el.children[i] !== childEl) el.insertBefore(childEl, el.children[i] ?? null);
    });
  }

  #style(m: Mounted, node: Node, parentLayout: Layout | null): void {
    const size = this.#sizeOf(node);
    const css = nodeBoxCss(node, parentLayout, size);
    if (node.kind === "frame") {
      Object.assign(css, frameLayoutCss(node.layout), frameStyleCss(node, this.#ctx.assetUrl));
    }
    if (node.hidden) css.display = "none"; // last: a frame's layout sets display too
    applyCss(m.el, css);
    m.el.className =
      node.kind === "frame" ? "v-frame" : `v-element v-type-${node.type.replaceAll(".", "-")}`;
  }

  #sizeOf(node: Node): { width: ResolvedSizing; height: ResolvedSizing } {
    const defaults =
      node.kind === "element"
        ? this.#options.registry.get(node.type)?.definition.defaultSize
        : undefined;
    return {
      width: node.width ?? defaults?.width ?? "auto",
      height: node.height ?? defaults?.height ?? "auto",
    };
  }

  #mountElement(m: Mounted, node: ElementNode): void {
    const registered = this.#options.registry.get(node.type);
    if (!registered) {
      placeholder(m.el, `Missing element type "${node.type}"`);
      return;
    }
    const instance = this.#guard(node.id, node.type, "mount", () =>
      registered.definition.mount(m.el, node.props, this.#ctx),
    );
    if (!instance) {
      m.el.replaceChildren();
      placeholder(m.el, `"${node.type}" failed to render`);
      return;
    }
    m.instance = instance;
    this.#guard(node.id, node.type, "seek", () => instance.seek(this.#time));
  }

  #disposeOne(id: string, m: Mounted): void {
    const instance = m.instance;
    if (instance && m.node.kind === "element")
      this.#guard(id, m.node.type, "dispose", () => instance.dispose());
    m.el.remove();
    this.#mounted.delete(id);
  }

  #guard<T>(nodeId: string, type: string, phase: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (error) {
      const report = this.#options.onPluginError ?? ((e: unknown) => console.error(e));
      report(error, { nodeId, type, phase });
      return undefined;
    }
  }
}

function sameKind(a: Node, b: Node): boolean {
  return a.kind === b.kind && (a.kind !== "element" || (b.kind === "element" && a.type === b.type));
}

/** A visible stand-in for an element that can't be drawn. */
function placeholder(el: HTMLElement, message: string): void {
  const box = el.ownerDocument.createElement("div");
  box.className = "v-placeholder";
  box.textContent = message; // never innerHTML: the type name comes from the document
  Object.assign(box.style, {
    width: "100%",
    height: "100%",
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "3px dashed #d14343",
    color: "#d14343",
    font: "500 20px system-ui, sans-serif",
    boxSizing: "border-box",
    padding: "8px",
  });
  el.append(box);
}
