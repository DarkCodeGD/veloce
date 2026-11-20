/**
 * The inspector: properties of the selection (or of the slide when nothing is selected).
 * Element props are generated from the plugin's schema (golden rule #5), so third-party
 * plugins get a working inspector for free. Every change is one undoable transaction.
 */
import {
  type Anchor,
  type AnchorEdge,
  type Deck,
  type ElementNode,
  type FrameNode,
  isFreeLayer,
  type Layout,
  type Node,
  type Shadow,
  type ShadowValue,
  type Slide,
  type Space,
  type Stroke,
  type Theme,
} from "@veloce/core";
import { NODE_ID_ATTR } from "@veloce/renderer";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  Copy,
  Group,
  LayoutGrid,
  Move,
  Rows3,
  Trash,
  Ungroup,
} from "lucide-react";
import { Fragment } from "react";
import { run } from "../actions.js";
import { registry, resolvedSizing } from "../editor-context.js";
import { groupSelection, ungroupSelection } from "../group-actions.js";
import { type Imported, replaceAsset } from "../model/asset-insert.js";
import { type Command, deleteNodes, duplicateNodes, updateNode } from "../model/commands.js";
import {
  addBorder,
  addShadow,
  CUSTOM,
  DEFAULT_STROKE,
  FRAME_BORDER,
  removeBorder,
  removeShadow,
  type StrokePath,
  setShadowPreset,
  shadowColor,
  shadowPreset,
  strokePatch,
} from "../model/frame-style.js";
import { ungroupable } from "../model/group.js";
import {
  freeSizing,
  type Measured,
  placeFreely,
  placeInFlow,
  setAnchor,
  switchLayout,
} from "../model/manipulate.js";
import { withPaintAssets } from "../model/paint.js";
import { propFields } from "../model/schema-fields.js";
import { parseNumber } from "../model/scrub.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { collapsePadding, paddingSides, SIDES, type Side, setPaddingSide } from "../model/sides.js";
import { indexSlide, nodeLabel, type SlideIndex } from "../model/slide-index.js";
import { shortcutAttrs } from "../platform.js";
import { setPreview } from "../preview.js";
import { AlignBar } from "./AlignBar.js";
import { AssetField } from "./AssetField.js";
import { mainCanvasSpace } from "./canvas-space.js";
import {
  AddableSection,
  ColorField,
  type Commit,
  LengthField,
  NumberField,
  Section,
  SelectField,
  SidesField,
  SizingField,
  TextField,
  ToggleField,
  TokenField,
} from "./fields.js";
import { ThemeSection } from "./ThemeSection.js";

interface Props {
  deck: Deck;
  slide: Slide;
  selection: readonly string[];
  onSelect(ids: string[]): void;
}

export function Inspector({ deck, slide, selection, onSelect }: Props) {
  const index = indexSlide(slide);
  const nodes = selection.flatMap((id) => index.nodes.get(id)?.node ?? []);

  let body: React.ReactNode;
  if (nodes.length === 0) {
    // Keyed by what's shown, so another slide or layer gets fresh fields: an open color
    // picker closes instead of carrying over to it (Figma does the same).
    body = (
      <Fragment key={slide.id}>
        <SlideSection deck={deck} slide={slide} />
        <ThemeSection deck={deck} />
      </Fragment>
    );
  } else if (nodes.length > 1) {
    body = (
      <Section title={`${nodes.length} layers`}>
        <LayerActions index={index} ids={selection} onSelect={onSelect} />
        <AlignBar index={index} ids={selection} />
      </Section>
    );
  } else {
    const node = nodes[0] as Node;
    const parent = index.nodes.get(node.id)?.parentId;
    const parentNode = parent ? index.nodes.get(parent)?.node : undefined;
    body = (
      <Fragment key={node.id}>
        <header className="inspector-head">
          <strong>{nodeLabel(node)}</strong>
          <span>
            {node.kind === "frame"
              ? "Frame"
              : (registry.get(node.type)?.definition.title ?? node.type)}
          </span>
        </header>
        <LayerActions index={index} ids={selection} onSelect={onSelect} />
        <AlignBar index={index} ids={selection} />
        <LayerSection
          index={index}
          node={node}
          parentLayout={parentNode?.kind === "frame" ? parentNode.layout : null}
        />
        {node.kind === "frame" ? (
          <FrameSections deck={deck} index={index} node={node} />
        ) : (
          <PropsSection deck={deck} node={node} />
        )}
      </Fragment>
    );
  }
  return (
    <aside className="inspector" aria-label="Inspector">
      {body}
    </aside>
  );
}

function LayerActions({
  index,
  ids,
  onSelect,
}: {
  index: ReturnType<typeof indexSlide>;
  ids: readonly string[];
  onSelect(ids: string[]): void;
}) {
  return (
    <div className="inspector-actions">
      <button
        type="button"
        className="button"
        data-tip="Duplicate"
        {...shortcutAttrs(SHORTCUTS.duplicate)}
        onClick={async () => {
          const command = duplicateNodes(index, ids);
          if (await run(command)) onSelect(command?.select ?? []);
        }}
      >
        <Copy size={14} /> Duplicate
      </button>
      <button
        type="button"
        className="button"
        data-tip="Group"
        {...shortcutAttrs(SHORTCUTS.group)}
        onClick={async () => {
          const select = await groupSelection(index, ids);
          if (select) onSelect(select);
        }}
      >
        <Group size={14} /> Group
      </button>
      {ungroupable(index, ids).length > 0 && (
        <button
          type="button"
          className="button"
          data-tip="Ungroup"
          {...shortcutAttrs(SHORTCUTS.ungroup)}
          onClick={async () => {
            const select = await ungroupSelection(index, ids);
            if (select) onSelect(select);
          }}
        >
          <Ungroup size={14} /> Ungroup
        </button>
      )}
      <button
        type="button"
        className="button button-danger"
        data-tip="Delete"
        {...shortcutAttrs(SHORTCUTS.delete)}
        onClick={async () => {
          if (await run(deleteNodes(index, ids), { undoToast: true })) onSelect([]);
        }}
      >
        <Trash size={14} /> Delete
      </button>
    </div>
  );
}

function SlideSection({ deck, slide }: { deck: Deck; slide: Slide }) {
  const set =
    (key: string, label: string): Commit =>
    (value) =>
      void run({ label, ops: [{ op: "slide.update", id: slide.id, set: { [key]: value } }] });
  return (
    <Section title="Slide">
      <TextField
        label="Name"
        value={slide.name}
        placeholder="Untitled"
        onCommit={set("name", "Rename slide")}
      />
      <ColorField
        label="Background"
        value={slide.background}
        theme={deck.theme}
        {...livePaint(deck, slide.id, slide.background, (value) => ({
          label: "Change slide background",
          ops: [{ op: "slide.update", id: slide.id, set: { background: value } }],
        }))}
      />
      <ToggleField
        label="Skip in show"
        value={slide.hidden}
        onCommit={set("hidden", "Toggle slide hidden")}
      />
      <p className="inspector-hint">Select a layer on the slide or in Layers to edit it.</p>
    </Section>
  );
}

/**
 * Handlers for fields that scrub or nudge: each value is previewed on the canvas only, then
 * one transaction commits the result and the preview is dropped once the server applied it
 * (the server sends `change` before `result`, so the value never flashes back).
 */
function live(toCommand: (value: unknown) => Command | null) {
  return {
    onPreview: (value: unknown) =>
      setPreview(value === null ? null : (toCommand(value)?.ops ?? null)),
    onCommit: (value: unknown) => void run(toCommand(value)).finally(() => setPreview(null)),
  };
}

/**
 * `live()` for a paint (fill, background), which can also be a gradient or an image: an image
 * uploaded for it is registered in the same step, and the image it replaces is dropped from
 * the deck if nothing else uses it (D66). `ownerId` is the slide or layer that owns it.
 */
function livePaint(
  deck: Deck,
  ownerId: string,
  previous: unknown,
  toCommand: (value: unknown) => Command | null,
) {
  return {
    paint: { deck },
    onPreview: live(toCommand).onPreview,
    onCommit: (value: unknown, imported?: Imported) => {
      const command = toCommand(value);
      const withFiles =
        command && withPaintAssets(command, deck, ownerId, previous, value, imported);
      void run(withFiles).finally(() => setPreview(null));
    },
  };
}

const canvasElement = (id: string) =>
  document.querySelector<HTMLElement>(`.editor-canvas [${NODE_ID_ATTR}="${CSS.escape(id)}"]`);

/** The rendered size of a node on the main canvas, in slide pixels. */
function renderedSize(id: string): { width: number; height: number } | undefined {
  const el = canvasElement(id);
  return el ? { width: el.offsetWidth, height: el.offsetHeight } : undefined;
}

/**
 * What an unset numeric property currently renders as, so scrubbing starts from the value
 * you see (e.g. a font size that comes from the text style token). Generic on purpose: it
 * reads the CSS property of the same name (`fontSize` → `font-size`) from the frame itself,
 * or from an element's plugin root, and ignores results outside the field's bounds (a
 * unitless `lineHeight` computes to pixels).
 */
function renderedNumber(
  id: string,
  property: string,
  target: "self" | "plugin",
  bounds: { min?: number; max?: number } = {},
): number | undefined {
  const node = canvasElement(id);
  const el = target === "plugin" ? (node?.firstElementChild ?? node) : node;
  if (!el) return undefined;
  const css = property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const value = parseNumber(getComputedStyle(el).getPropertyValue(css).split(" ")[0] ?? "");
  if (value === null) return undefined;
  if (value < (bounds.min ?? Number.NEGATIVE_INFINITY)) return undefined;
  if (value > (bounds.max ?? Number.POSITIVE_INFINITY)) return undefined;
  return value;
}

/**
 * Position: Auto / Free for a layer in a stack or grid. Free bakes where it is now (and any
 * stretched size) so nothing jumps; Auto hands it back to the layout.
 */
/** What a free layer's X/Y field measures, by the edge it's pinned to (core's anchor.ts). */
const AXIS_LABEL: Record<"x" | "y", Record<AnchorEdge, string>> = {
  x: { start: "X", center: "X from middle", end: "From right" },
  y: { start: "Y", center: "Y from middle", end: "From bottom" },
};

/** Pin a free layer to other edges of its frame, measured on the canvas so it stays put. */
function pin(index: SlideIndex, node: Node, anchor: Anchor) {
  const space = mainCanvasSpace();
  const parentId = index.nodes.get(node.id)?.parentId;
  const size = space?.size(node.id);
  const content = parentId ? space?.frameSize(parentId) : null;
  if (!size || !content) return;
  void run(setAnchor(index, node.id, anchor, { size, content }));
}

function setPositioning(index: SlideIndex, node: Node, parentLayout: Layout, value: unknown) {
  if (value !== "free") return void run(placeInFlow(index, node.id));
  const space = mainCanvasSpace();
  const at = space?.offsetInParent(node.id) ?? { x: 0, y: 0 };
  const size = space?.size(node.id);
  const sizes = size ? freeSizing(parentLayout, resolvedSizing(node), size) : {};
  void run(placeFreely(index, node.id, at, sizes));
}

function LayerSection({
  index,
  node,
  parentLayout,
}: {
  index: SlideIndex;
  node: Node;
  parentLayout: Layout | null;
}) {
  const set =
    (key: string, label: string): Commit =>
    (value) =>
      void run(updateNode(node.id, { [key]: value }, label));
  const setLive = (key: string, label: string) =>
    live((value) => updateNode(node.id, { [key]: value }, label));
  const move = (axis: "x" | "y") =>
    live((value) =>
      updateNode(
        node.id,
        { position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0, [axis]: value ?? 0 } },
        "Move layer",
      ),
    );
  const size = renderedSize(node.id);
  return (
    <Section title="Layer">
      <TextField
        label="Name"
        value={node.name}
        placeholder={nodeLabel(node)}
        onCommit={set("name", "Rename layer")}
      />
      <SizingField
        label="Width"
        value={node.width}
        current={size?.width}
        {...setLive("width", "Change width")}
      />
      <SizingField
        label="Height"
        value={node.height}
        current={size?.height}
        {...setLive("height", "Change height")}
      />
      {parentLayout && parentLayout.mode !== "absolute" && (
        <SelectField
          label="Position"
          value={node.positioning}
          options={[
            { value: "auto", label: "Auto", icon: <Rows3 size={14} /> },
            { value: "free", label: "Free", icon: <Move size={14} /> },
          ]}
          defaultValue="auto"
          onCommit={(v) => setPositioning(index, node, parentLayout, v)}
        />
      )}
      {parentLayout && isFreeLayer(node, parentLayout) && (
        <>
          <SelectField
            label="Pin X"
            value={node.anchor?.x}
            options={[
              { value: "start", label: "Left", icon: <AlignStartVertical size={14} /> },
              { value: "center", label: "Center", icon: <AlignCenterVertical size={14} /> },
              { value: "end", label: "Right", icon: <AlignEndVertical size={14} /> },
            ]}
            defaultValue="start"
            onCommit={(v) => pin(index, node, { ...node.anchor, x: v as AnchorEdge })}
          />
          <NumberField
            label={AXIS_LABEL.x[node.anchor?.x ?? "start"]}
            value={node.position?.x}
            placeholder="0"
            suffix="px"
            {...move("x")}
          />
          <SelectField
            label="Pin Y"
            value={node.anchor?.y}
            options={[
              { value: "start", label: "Top", icon: <AlignStartHorizontal size={14} /> },
              { value: "center", label: "Middle", icon: <AlignCenterHorizontal size={14} /> },
              { value: "end", label: "Bottom", icon: <AlignEndHorizontal size={14} /> },
            ]}
            defaultValue="start"
            onCommit={(v) => pin(index, node, { ...node.anchor, y: v as AnchorEdge })}
          />
          <NumberField
            label={AXIS_LABEL.y[node.anchor?.y ?? "start"]}
            value={node.position?.y}
            placeholder="0"
            suffix="px"
            {...move("y")}
          />
        </>
      )}
      <NumberField
        label="Opacity"
        value={node.opacity === undefined ? undefined : node.opacity * 100}
        placeholder="100"
        min={0}
        max={100}
        suffix="%"
        {...live((v) =>
          updateNode(
            node.id,
            { opacity: v === null || v === 100 ? null : (v as number) / 100 },
            "Change opacity",
          ),
        )}
      />
      <NumberField
        label="Rotation"
        value={node.rotation}
        placeholder="0"
        min={-360}
        max={360}
        suffix="°"
        {...setLive("rotation", "Rotate layer")}
      />
      <ToggleField label="Hidden" value={node.hidden} onCommit={set("hidden", "Toggle hidden")} />
      <ToggleField label="Locked" value={node.locked} onCommit={set("locked", "Toggle locked")} />
    </Section>
  );
}

const ALIGN = ["start", "center", "end", "stretch"];
/** Where each side's "Custom…" starts: its rendered padding. */
const PADDING_CSS: Record<Side, string> = {
  top: "paddingTop",
  right: "paddingRight",
  bottom: "paddingBottom",
  left: "paddingLeft",
};
const JUSTIFY = ["start", "center", "end", "space-between", "space-around", "space-evenly"];

/** Measure a layer on the main canvas, for edits that must keep it where it is. */
function measureOnCanvas(index: SlideIndex): (id: string) => Measured | null {
  const space = mainCanvasSpace();
  return (id) => {
    const node = index.nodes.get(id)?.node;
    const position = space?.offsetInParent(id);
    const size = space?.size(id);
    if (!node || !position || !size) return null;
    return { position, rendered: size, sizing: resolvedSizing(node) };
  };
}

function FrameSections({ deck, index, node }: { deck: Deck; index: SlideIndex; node: FrameNode }) {
  const layout = node.layout;
  const setLayout =
    (key: string, label: string): Commit =>
    (value) =>
      void run(updateNode(node.id, { layout: { [key]: value } }, label));
  const switchMode = (mode: string | null) => {
    if (mode !== "stack" && mode !== "grid" && mode !== "absolute") return;
    void run(switchLayout(index, node.id, mode, measureOnCanvas(index)));
  };
  const setStyle =
    (key: string, label: string): Commit =>
    (value) =>
      void run(updateNode(node.id, { style: { [key]: value } }, label));
  const liveLayout = (key: string, label: string) =>
    live((value) => updateNode(node.id, { layout: { [key]: value } }, label));
  const liveStyle = (key: string, label: string) =>
    live((value) => updateNode(node.id, { style: { [key]: value } }, label));
  /** Where "Custom…" starts: the frame's rendered CSS value. */
  const rendered = (property: string) => () =>
    renderedNumber(node.id, property, "self", { min: 0 });

  return (
    <>
      <Section title="Auto layout">
        <SelectField
          label="Mode"
          value={layout.mode}
          options={[
            { value: "stack", label: "Stack", icon: <Rows3 size={14} /> },
            { value: "grid", label: "Grid", icon: <LayoutGrid size={14} /> },
            { value: "absolute", label: "Free (absolute)", icon: <Move size={14} /> },
          ]}
          onCommit={(v) => switchMode(v as string | null)}
        />
        {layout.mode === "stack" && (
          <>
            <SelectField
              label="Direction"
              value={layout.direction}
              options={[
                { value: "column", label: "Vertical", icon: <ArrowDown size={14} /> },
                { value: "row", label: "Horizontal", icon: <ArrowRight size={14} /> },
              ]}
              defaultValue="column"
              onCommit={setLayout("direction", "Change direction")}
            />
            <SelectField
              label="Align"
              value={layout.align}
              options={ALIGN}
              defaultValue="stretch"
              onCommit={setLayout("align", "Change alignment")}
            />
            <SelectField
              label="Justify"
              value={layout.justify}
              options={JUSTIFY}
              defaultValue="start"
              onCommit={setLayout("justify", "Change distribution")}
            />
            <ToggleField
              label="Wrap"
              value={layout.wrap}
              onCommit={setLayout("wrap", "Toggle wrap")}
            />
          </>
        )}
        {layout.mode === "grid" && (
          <>
            <NumberField
              label="Columns"
              value={layout.columns}
              min={1}
              max={24}
              integer
              {...live((v) =>
                updateNode(
                  node.id,
                  { layout: { columns: Math.round((v as number | null) ?? 2) } },
                  "Change columns",
                ),
              )}
            />
            <SelectField
              label="Align"
              value={layout.align}
              options={ALIGN}
              defaultValue="stretch"
              onCommit={setLayout("align", "Change alignment")}
            />
          </>
        )}
        {layout.mode !== "absolute" && (
          <LengthField
            label="Gap"
            value={layout.gap}
            theme={deck.theme}
            group="space"
            current={rendered("rowGap")}
            {...liveLayout("gap", "Change gap")}
          />
        )}
        {layout.mode === "absolute" ? (
          <p className="inspector-hint">
            Free layers are placed from the frame's edges; pin them with Pin X / Pin Y.
          </p>
        ) : (
          <SidesField
            label="Padding"
            toggleLabel="Individual sides"
            sides={SIDES}
            values={paddingSides(layout.padding)}
            theme={deck.theme}
            group="space"
            all={liveLayout("padding", "Change padding")}
            side={(key) =>
              live((value) => setPaddingSide(node.id, layout.padding, key, value as Space | null))
            }
            current={(key) => rendered(PADDING_CSS[key])}
            onCollapse={() => void run(collapsePadding(node.id, layout.padding))}
          />
        )}
      </Section>
      <Section title="Fill & shape">
        <ColorField
          label="Fill"
          value={node.style?.fill}
          theme={deck.theme}
          {...livePaint(deck, node.id, node.style?.fill, (value) =>
            updateNode(node.id, { style: { fill: value } }, "Change fill"),
          )}
        />
        <LengthField
          label="Radius"
          value={typeof node.style?.radius === "object" ? undefined : node.style?.radius}
          theme={deck.theme}
          group="radius"
          current={rendered("borderTopLeftRadius")}
          {...liveStyle("radius", "Change radius")}
        />
        <ToggleField
          label="Clip content"
          value={node.style?.clip}
          onCommit={setStyle("clip", "Toggle clipping")}
        />
      </Section>
      <BorderSection deck={deck} nodeId={node.id} stroke={node.style?.stroke} />
      <ShadowSection theme={deck.theme} node={node} shadow={node.style?.shadow} />
    </>
  );
}

const BORDER_STYLES = ["solid", "dashed", "dotted"];

/**
 * A border: a frame's `style.stroke` (D74), or an element's stroke prop such as a shape's
 * outline (`path`). **+** adds one; then color, width and line style.
 */
function BorderSection({
  deck,
  nodeId,
  stroke,
  path = FRAME_BORDER,
}: {
  deck: Deck;
  nodeId: string;
  stroke?: Stroke;
  path?: StrokePath;
}) {
  const set = (value: Partial<Stroke>, label: string) =>
    updateNode(nodeId, strokePatch(path, value), label);
  /** Live-previewed edit of one border key; `null` (cleared) is ignored: they're required. */
  const liveStroke = (key: "color" | "width", label: string) =>
    live((value) => (value === null ? null : set({ [key]: value }, label)));
  return (
    <AddableSection
      title="Border"
      noun="border"
      present={stroke !== undefined}
      onAdd={() => void run(addBorder(nodeId, path))}
      onRemove={() => void run(removeBorder(nodeId, path))}
    >
      {stroke && (
        <>
          <ColorField
            label="Color"
            value={stroke.color}
            theme={deck.theme}
            required
            {...liveStroke("color", "Change border color")}
          />
          <NumberField
            label="Width"
            value={stroke.width}
            min={0.5}
            max={1000}
            step={1}
            suffix="px"
            required
            fallback={() => DEFAULT_STROKE.width}
            {...liveStroke("width", "Change border width")}
          />
          <SelectField
            label="Style"
            value={stroke.style}
            options={BORDER_STYLES}
            defaultValue="solid"
            onCommit={(value) =>
              void run(set({ style: value as Stroke["style"] }, "Change border style"))
            }
          />
        </>
      )}
    </AddableSection>
  );
}

/** The Shadow menu: the theme's shadows, then Custom (explicit values). */
function shadowOptions(theme: Theme) {
  return [
    ...Object.entries(theme.shadow).map(([name, value]) => ({
      value: `$shadow.${name}`,
      label: name,
      hint: `${value.y}px · blur ${value.blur}`,
    })),
    { value: CUSTOM, label: "Custom" },
  ];
}

/**
 * A frame's drop shadow (`style.shadow`, D74): **+** adds the theme's; pick another theme
 * shadow, or Custom to set its offset, blur, spread and color.
 */
function ShadowSection({
  theme,
  node,
  shadow,
}: {
  theme: Theme;
  node: FrameNode;
  shadow?: ShadowValue;
}) {
  const custom = shadow !== undefined && typeof shadow !== "string" ? shadow : undefined;
  /**
   * Live-previewed edit of one value of a custom shadow. They're required, so a cleared field
   * (`null`) is ignored; `toValue` can reject a value the same way.
   */
  const liveShadow = (
    key: keyof Shadow,
    label: string,
    toValue: (v: unknown) => unknown = (v) => v,
  ) =>
    live((value) => {
      const next = value === null ? null : toValue(value);
      return next === null
        ? null
        : updateNode(node.id, { style: { shadow: { [key]: next } } }, label);
    });
  return (
    <AddableSection
      title="Shadow"
      noun="shadow"
      present={shadow !== undefined}
      onAdd={() => void run(addShadow(node.id, theme))}
      onRemove={() => void run(removeShadow(node.id))}
    >
      {shadow !== undefined && (
        <>
          <SelectField
            label="Preset"
            value={shadowPreset(shadow)}
            options={shadowOptions(theme)}
            onCommit={(preset) =>
              typeof preset === "string" &&
              void run(setShadowPreset(node.id, theme, shadow, preset))
            }
          />
          {custom && (
            <>
              <NumberField
                label="X"
                value={custom.x}
                suffix="px"
                required
                {...liveShadow("x", "Change shadow offset")}
              />
              <NumberField
                label="Y"
                value={custom.y}
                suffix="px"
                required
                {...liveShadow("y", "Change shadow offset")}
              />
              <NumberField
                label="Blur"
                value={custom.blur}
                min={0}
                suffix="px"
                required
                {...liveShadow("blur", "Change shadow blur")}
              />
              <NumberField
                label="Spread"
                value={custom.spread}
                placeholder="0"
                suffix="px"
                {...live((value) =>
                  updateNode(
                    node.id,
                    { style: { shadow: { spread: value } } },
                    "Change shadow spread",
                  ),
                )}
              />
              <ColorField
                label="Color"
                value={custom.color}
                theme={theme}
                required
                {...liveShadow("color", "Change shadow color", (v) => shadowColor(theme, v))}
              />
            </>
          )}
        </>
      )}
    </AddableSection>
  );
}

function PropsSection({ deck, node }: { deck: Deck; node: ElementNode }) {
  const definition = registry.get(node.type)?.definition;
  if (!definition) {
    return (
      <Section title="Properties">
        <p className="inspector-hint">
          The "{node.type}" plugin isn't installed, so its properties can't be edited.
        </p>
      </Section>
    );
  }
  const props = node.props as Record<string, unknown>;
  const fields = propFields(definition);
  return (
    <>
      <Section title={definition.title}>
        {fields.map((field) => {
          const value = props[field.key];
          const toCommand = (v: unknown) =>
            updateNode(
              node.id,
              { props: { [field.key]: v } },
              `Change ${field.label.toLowerCase()}`,
            );
          const common = { label: field.label, onCommit: (v: unknown) => void run(toCommand(v)) };
          switch (field.kind) {
            case "enum":
              return (
                <SelectField
                  key={field.key}
                  {...common}
                  value={value as string | undefined}
                  options={field.options}
                  defaultLabel="Default"
                />
              );
            case "boolean":
              return (
                <ToggleField key={field.key} {...common} value={value as boolean | undefined} />
              );
            case "number":
              return (
                <NumberField
                  key={field.key}
                  {...common}
                  value={value as number | undefined}
                  placeholder="Default"
                  min={field.min}
                  max={field.max}
                  integer={field.integer}
                  fallback={() =>
                    field.default ??
                    renderedNumber(node.id, field.key, "plugin", { min: field.min, max: field.max })
                  }
                  {...live(toCommand)}
                />
              );
            case "token":
              return (
                <TokenField
                  key={field.key}
                  {...common}
                  value={value as string | undefined}
                  theme={deck.theme}
                  group={field.group}
                />
              );
            case "color":
              return (
                <ColorField
                  key={field.key}
                  {...common}
                  value={value}
                  theme={deck.theme}
                  {...live(toCommand)}
                />
              );
            case "paint":
              return (
                <ColorField
                  key={field.key}
                  {...common}
                  value={value}
                  theme={deck.theme}
                  {...livePaint(deck, node.id, value, toCommand)}
                />
              );
            case "length":
              return (
                <LengthField
                  key={field.key}
                  {...common}
                  value={value}
                  theme={deck.theme}
                  group={field.group}
                  current={() => renderedNumber(node.id, field.key, "plugin", { min: 0 })}
                  {...live(toCommand)}
                />
              );
            case "text":
              return (
                <TextField
                  key={field.key}
                  {...common}
                  value={value as string | undefined}
                  multiline={field.multiline}
                />
              );
            case "richText":
              return typeof value === "string" || value === undefined ? (
                <TextField
                  key={field.key}
                  {...common}
                  value={value as string | undefined}
                  multiline
                />
              ) : (
                <p key={field.key} className="inspector-hint">
                  {field.label}: formatted text. Double-click it on the slide (or press Enter) to
                  edit it there.
                </p>
              );
            case "asset":
              return (
                <AssetField
                  key={field.key}
                  label={field.label}
                  value={value}
                  deck={deck}
                  onReplace={(next) =>
                    void run(replaceAsset(deck, node.id, field.key, value, next))
                  }
                />
              );
            case "readonly":
              return (
                <p key={field.key} className="inspector-hint">
                  {field.label}: {value === undefined ? "default" : "set"} (not editable here yet).
                </p>
              );
            default:
              return null;
          }
        })}
      </Section>
      {/* Strokes get their own Border section below, as on frames (a shape's outline). */}
      {fields.map(
        (field) =>
          field.kind === "stroke" && (
            <BorderSection
              key={field.key}
              deck={deck}
              nodeId={node.id}
              stroke={props[field.key] as Stroke | undefined}
              path={{ at: "props", key: field.key }}
            />
          ),
      )}
    </>
  );
}
