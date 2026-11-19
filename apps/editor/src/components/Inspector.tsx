/**
 * The inspector: properties of the selection (or of the slide when nothing is selected).
 * Element props are generated from the plugin's schema (golden rule #5), so third-party
 * plugins get a working inspector for free. Every change is one undoable transaction.
 */
import {
  type Deck,
  type ElementNode,
  type FrameNode,
  isFreeLayer,
  type Layout,
  type Node,
  type Slide,
} from "@veloce/core";
import { NODE_ID_ATTR } from "@veloce/renderer";
import { ArrowDown, ArrowRight, Copy, LayoutGrid, Move, Rows3, Trash } from "lucide-react";
import { run } from "../actions.js";
import { registry, resolvedSizing } from "../editor-context.js";
import { replaceAsset } from "../model/asset-insert.js";
import { type Command, deleteNodes, duplicateNodes, updateNode } from "../model/commands.js";
import {
  freeSizing,
  type Measured,
  placeFreely,
  placeInFlow,
  switchLayout,
} from "../model/manipulate.js";
import { propFields } from "../model/schema-fields.js";
import { parseNumber } from "../model/scrub.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { indexSlide, nodeLabel, type SlideIndex } from "../model/slide-index.js";
import { shortcutAttrs } from "../platform.js";
import { setPreview } from "../preview.js";
import { AssetField } from "./AssetField.js";
import { mainCanvasSpace } from "./canvas-space.js";
import {
  ColorField,
  type Commit,
  LengthField,
  NumberField,
  Section,
  SelectField,
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
    body = (
      <>
        <SlideSection deck={deck} slide={slide} />
        <ThemeSection deck={deck} />
      </>
    );
  } else if (nodes.length > 1) {
    body = (
      <Section title={`${nodes.length} layers`}>
        <LayerActions index={index} ids={selection} onSelect={onSelect} />
      </Section>
    );
  } else {
    const node = nodes[0] as Node;
    const parent = index.nodes.get(node.id)?.parentId;
    const parentNode = parent ? index.nodes.get(parent)?.node : undefined;
    body = (
      <>
        <header className="inspector-head">
          <strong>{nodeLabel(node)}</strong>
          <span>
            {node.kind === "frame"
              ? "Frame"
              : (registry.get(node.type)?.definition.title ?? node.type)}
          </span>
        </header>
        <LayerActions index={index} ids={selection} onSelect={onSelect} />
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
      </>
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
        onCommit={set("background", "Change slide background")}
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
    onPreview: (value: number | null) =>
      setPreview(value === null ? null : (toCommand(value)?.ops ?? null)),
    onCommit: (value: unknown) => void run(toCommand(value)).finally(() => setPreview(null)),
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
          <NumberField
            label="X"
            value={node.position?.x}
            placeholder="0"
            suffix="px"
            {...move("x")}
          />
          <NumberField
            label="Y"
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
  const padding = typeof layout.padding === "object" ? undefined : layout.padding;

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
        {typeof layout.padding === "object" ? (
          <p className="inspector-hint">Padding: per-side values (set by AI).</p>
        ) : (
          <LengthField
            label="Padding"
            value={padding}
            theme={deck.theme}
            group="space"
            current={rendered("paddingTop")}
            {...liveLayout("padding", "Change padding")}
          />
        )}
      </Section>
      <Section title="Fill & shape">
        <ColorField
          label="Fill"
          value={node.style?.fill}
          theme={deck.theme}
          onCommit={setStyle("fill", "Change fill")}
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
    </>
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
  return (
    <Section title={definition.title}>
      {propFields(definition).map((field) => {
        const value = props[field.key];
        const toCommand = (v: unknown) =>
          updateNode(node.id, { props: { [field.key]: v } }, `Change ${field.label.toLowerCase()}`);
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
            return <ToggleField key={field.key} {...common} value={value as boolean | undefined} />;
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
          case "paint":
            return <ColorField key={field.key} {...common} value={value} theme={deck.theme} />;
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
                {field.label}: formatted text. Double-click it on the slide (or press Enter) to edit
                it there.
              </p>
            );
          case "asset":
            return (
              <AssetField
                key={field.key}
                label={field.label}
                value={value}
                deck={deck}
                onReplace={(next) => void run(replaceAsset(deck, node.id, field.key, value, next))}
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
  );
}
