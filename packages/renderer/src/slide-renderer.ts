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
 *
 * Fields and the footer (D97): elements read the slide's field values (its number, the
 * deck's title…) from their context. Those change without the slide changing (another slide
 * moved, the deck was renamed), so every render compares them and re-draws the elements that
 * use fields. The deck's footer is drawn over the slide from core's `footerNode`, through the
 * same code as the slide's own nodes, and is click-through: it isn't a layer.
 *
 * Motion (D83 §5, D103): `setMotion` draws layers away from their rest position (move,
 * turn, scale, fade, blur) without touching layout. The renderer is the only writer of a
 * layer's `transform`, `opacity` and `filter`: it combines the motion with the layer's own
 * rotation, anchor and opacity, and keeps it when an edit restyles the layer mid-playback.
 * `playMotion` hands motion to the browser's compositor instead (D107, D115): keyframes
 * composed the same way, as Web Animations this renderer starts, owns and cancels.
 */
import {
  type Deck,
  type ElementNode,
  type FieldValues,
  type FrameNode,
  fieldValues,
  findSlide,
  footerNode,
  hasFieldRuns,
  isFooterId,
  isRestMotion,
  type Layout,
  type MotionClip,
  type MotionState,
  type Node,
  type Slide,
  type SlideMeasurement,
  sameFieldValues,
  sameMotion,
  walkNodes,
} from "@veloce/core";
import type { ElementContext, ElementInstance, PluginRegistry } from "@veloce/plugin-api";
import { cssSlideBackground } from "@veloce/plugin-api";
import {
  applyCss,
  frameLayoutCss,
  frameSpaceCss,
  frameStyleCss,
  MOTION_PROPERTIES,
  motionKeyframes,
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
  /** Today, for the date field (D97). Default: the clock. Tests and exports pin it. */
  now?(): Date;
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
  /** Layers drawn away from their rest position, by node ID (only ones not at rest). */
  #motion = new Map<string, MotionState>();
  #slide: Slide | null = null;
  #theme: Deck["theme"] | null = null;
  #fields: FieldValues | null = null;
  /** The footer drawn now, and what it was built from (rebuilt only when that changes). */
  #footer: FrameNode | null = null;
  #footerFrom: { footer: Deck["footer"]; slide: Slide | null } = { footer: undefined, slide: null };
  #time = 0;
  #disposed = false;
  /** Web Animations playing motion on the compositor, by node ID, with their clip's start. */
  #clips = new Map<string, { animation: Animation; start: number }[]>();

  /** `stage` is an empty element the renderer owns; it's sized to the deck's stage. */
  constructor(stage: HTMLElement, options: SlideRendererOptions) {
    this.#stage = stage;
    this.#options = options;
    this.#ctx = { assetUrl: (id) => options.assetUrl(id), fields: () => this.#fields };
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
    const found = findSlide(deck, slideId);
    const slide = found?.slide ?? null;
    const stage = this.#stage;
    stage.style.width = `${deck.stage.width}px`;
    stage.style.height = `${deck.stage.height}px`;
    // The deck's language (D76): screen readers read the slides in it, and the browser picks
    // its hyphenation and spell-check dictionary from it. Unset: inherit the page's.
    if (deck.meta.language) stage.lang = deck.meta.language;
    else stage.removeAttribute("lang");
    stage.style.overflow = "hidden";
    if (deck.theme !== this.#theme) {
      applyTheme(stage, deck.theme);
      this.#theme = deck.theme;
    }
    if (!found || !slide) {
      this.#clear();
      return;
    }
    // Set before drawing: elements mounted below read them.
    const values = fieldValues(deck, found.index, this.#options.now?.() ?? new Date());
    const fieldsChanged = !sameFieldValues(this.#fields, values);
    this.#fields = values;
    const footer = this.#footerOf(deck, slide);

    if (slide !== this.#slide || footer !== this.#footer) {
      stage.style.background = cssSlideBackground(
        slide.background ?? "$color.background",
        this.#ctx.assetUrl,
      );
      // Dispose nodes that are gone *before* mounting new ones, so heavy plugins (WebGL…) free
      // their resources first. IDs are unique per deck, so an ID still present is the same node.
      const live = new Set<string>();
      for (const { node } of walkNodes(slide.root)) live.add(node.id);
      if (footer) for (const { node } of walkNodes(footer)) live.add(node.id);
      for (const [id, mounted] of this.#mounted) {
        if (!live.has(id)) this.#disposeOne(id, mounted);
      }
      const rootEl = this.#renderNode(slide.root, null);
      if (stage.firstChild !== rootEl) stage.prepend(rootEl);
      if (footer) {
        const footerEl = this.#renderNode(footer, null);
        footerEl.classList.add("v-footer");
        footerEl.style.pointerEvents = "none"; // click through to the slide
        if (rootEl.nextSibling !== footerEl) rootEl.after(footerEl);
      }
      this.#slide = slide;
      this.#footer = footer;
    }
    if (fieldsChanged) {
      // New values (another slide moved, the deck was renamed): re-draw the elements that
      // show them, including untouched ones the pass above skipped.
      for (const [id, m] of this.#mounted) {
        const { node, instance } = m;
        if (instance && node.kind === "element" && hasFieldRuns(node.props)) {
          this.#guard(id, node.type, "update", () => instance.update(node.props));
        }
      }
    }
  }

  /** Show every element as it looks `time` seconds into the slide (golden rule #3). */
  seek(time: number): void {
    this.#time = time;
    for (const [id, m] of this.#mounted) {
      if (m.instance && m.node.kind === "element")
        this.#guard(id, m.node.type, "seek", () => m.instance?.seek(time));
    }
  }

  /**
   * Draw layers away from their rest position: `motion` maps node IDs to their motion now;
   * every layer not in it is drawn at rest. Replaces the previous call's motion, so the clock
   * passes everything that moves on each frame. Only layers whose motion changed are
   * touched, and only their `transform`, `opacity` and `filter`: no layout, no plugin calls.
   * IDs not on this slide are kept, so a layer an edit adds later starts where it should.
   */
  setMotion(motion: ReadonlyMap<string, MotionState>): void {
    const previous = this.#motion;
    const next = new Map<string, MotionState>();
    for (const [id, state] of motion) if (!isRestMotion(state)) next.set(id, state);
    this.#motion = next;
    for (const [id, m] of this.#mounted) {
      const before = previous.get(id);
      const after = next.get(id);
      if (!sameMotion(before, after)) this.#applyMotion(m, after);
    }
  }

  /**
   * Play motion on the compositor (D107): each layer's clips become Web Animations of its
   * `transform`, `opacity` and `filter`, composed like `setMotion` draws them. `origin` is
   * the time on `document.timeline` at which the slide's time is 0, so clips (in slide
   * time) start in step with each other and with the clock. Replaces what was playing.
   * Where a clip isn't playing, a layer shows what `setMotion` last drew.
   */
  playMotion(clips: ReadonlyMap<string, readonly MotionClip[]>, origin: number): void {
    this.stopMotion();
    for (const [id, layerClips] of clips) {
      const m = this.#mounted.get(id);
      if (!m) continue;
      const playing: { animation: Animation; start: number }[] = [];
      for (const clip of layerClips) {
        const end = clip.times.at(-1) ?? clip.start;
        const duration = end - clip.start;
        if (duration <= 0) continue;
        const frames = motionKeyframes(m.node, m.parentLayout, clip.states);
        if (Object.keys(frames[0] ?? {}).length === 0) continue; // nothing it shows changes
        const keyframes = frames.map((css, i) => ({
          ...css,
          offset: ((clip.times[i] ?? end) - clip.start) / duration,
        }));
        const animation = m.el.animate(keyframes, {
          duration,
          easing: "linear",
          iterations: clip.loop ? Number.POSITIVE_INFINITY : 1,
          // A finished clip holds its last frame; a loop clip only shows while it loops, and
          // being created later, it plays over the clip before it.
          fill: clip.loop ? "none" : "forwards",
        });
        animation.startTime = origin + clip.start;
        playing.push({ animation, start: clip.start });
      }
      if (playing.length > 0) this.#clips.set(id, playing);
    }
  }

  /** Freeze the compositor's motion, at slide time `time` if given (else where it is). */
  pauseMotion(time?: number): void {
    for (const clips of this.#clips.values()) {
      for (const { animation, start } of clips) {
        animation.pause();
        if (time !== undefined) animation.currentTime = time - start;
      }
    }
  }

  /** Stop the compositor's motion: layers show what `setMotion` last drew. */
  stopMotion(): void {
    for (const clips of this.#clips.values()) for (const { animation } of clips) animation.cancel();
    this.#clips.clear();
  }

  /** Resolves when fonts and images on the stage have loaded, so measurements are final. */
  async ready(): Promise<void> {
    const doc = this.#stage.ownerDocument;
    await doc.fonts?.ready;
    const images = [...this.#stage.querySelectorAll("img")];
    await Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => {}))));
  }

  /**
   * Bounds, overflow and text colors of every visible node (needs a real browser layout).
   * Bounds are where layers are drawn, motion included: clear it first for the rest layout.
   */
  measure(): SlideMeasurement | null {
    if (!this.#slide) return null;
    const els = new Map<string, HTMLElement>();
    for (const [id, m] of this.#mounted) if (!isFooterId(id)) els.set(id, m.el); // not a layer
    return measureSlide(this.#stage, this.#slide.id, els);
  }

  /**
   * Where each layer's box sits in its parent frame (stage pixels, motion left out) with the
   * layers in `absent` taken out of the layout (D120): core measures each layout state of a
   * slide once, so the layers around one that joins or leaves can glide between them. The
   * slide is laid out for the measurement and put back at once; nothing is re-rendered.
   */
  measureLayout(absent: ReadonlySet<string>): Map<string, { x: number; y: number }> {
    const hidden: { el: HTMLElement; display: string }[] = [];
    for (const id of absent) {
      const m = this.#mounted.get(id);
      if (!m) continue;
      hidden.push({ el: m.el, display: m.el.style.display });
      m.el.style.display = "none";
    }
    const boxes = new Map<string, { x: number; y: number }>();
    try {
      for (const [id, m] of this.#mounted) {
        if (isFooterId(id) || absent.has(id) || m.el.offsetParent === null) continue;
        // Layout offsets ignore transforms (motion, rotation, the stage's zoom), which is
        // what a glide adds to: the move from one layout to the other, in the frame's axes.
        boxes.set(id, { x: m.el.offsetLeft, y: m.el.offsetTop });
      }
    } finally {
      for (const { el, display } of hidden) el.style.display = display;
    }
    return boxes;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#clear();
    this.#disposed = true;
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────

  #clear(): void {
    for (const [id, mounted] of this.#mounted) this.#disposeOne(id, mounted);
    this.#motion = new Map();
    this.#slide = null;
    this.#footer = null;
    this.#footerFrom = { footer: undefined, slide: null };
    this.#fields = null;
  }

  /** The footer for this slide, the same object as last time unless what it's built from changed. */
  #footerOf(deck: Deck, slide: Slide): FrameNode | null {
    const from = this.#footerFrom;
    const same =
      from.footer === deck.footer && from.slide?.hideFooter === slide.hideFooter && from.slide;
    if (!same) {
      this.#footerFrom = { footer: deck.footer, slide };
      return footerNode(deck, slide);
    }
    this.#footerFrom.slide = slide;
    return this.#footer;
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
    const css = nodeBoxCss(node, parentLayout, size, this.#motion.get(node.id));
    if (node.kind === "frame") {
      Object.assign(
        css,
        frameLayoutCss(node.layout),
        frameStyleCss(node, this.#ctx.assetUrl),
        frameSpaceCss(node),
      );
    }
    if (node.hidden) css.display = "none"; // last: a frame's layout sets display too
    applyCss(m.el, css);
    m.el.className =
      node.kind === "frame" ? "v-frame" : `v-element v-type-${node.type.replaceAll(".", "-")}`;
  }

  /** Rewrite only the properties motion changes (a frame's own style never sets them). */
  #applyMotion(m: Mounted, motion: MotionState | undefined): void {
    const css = nodeBoxCss(m.node, m.parentLayout, this.#sizeOf(m.node), motion);
    for (const property of MOTION_PROPERTIES) {
      const value = css[property];
      if (value === undefined) m.el.style.removeProperty(property);
      else m.el.style.setProperty(property, value);
    }
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
    for (const { animation } of this.#clips.get(id) ?? []) animation.cancel();
    this.#clips.delete(id);
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
