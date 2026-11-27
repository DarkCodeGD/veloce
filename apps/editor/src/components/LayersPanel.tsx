/**
 * The layer tree of the current slide. Every canvas action has a path here too: select
 * (Shift+click for a range, Ctrl/Cmd+click to toggle one, see model/layer-select.ts), rename (double-click or F2), hide, lock, and move. Drag rows to reorder them or to move
 * layers into or out of frames (useLayerDrag); Alt+↑/↓ reorders from the keyboard (handled
 * by the app's shortcuts).
 */
import type { LintSeverity, Node, Slide } from "@veloce/core";
import {
  ArrowBigRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Columns3,
  Eye,
  EyeOff,
  Hexagon,
  Image,
  LayoutGrid,
  Lock,
  LockOpen,
  type LucideIcon,
  MoveUpRight,
  PenTool,
  Rows3,
  Slash,
  Square,
  Star,
  Triangle,
  Type,
} from "lucide-react";
import { useRef, useState } from "react";
import { run } from "../actions.js";
import { updateNode } from "../model/commands.js";
import { clickLayer, type LayerAnchor } from "../model/layer-select.js";
import { nodeLabel } from "../model/slide-index.js";
import { INDENT, ROW_PAD, useLayerDrag } from "./useLayerDrag.js";

interface Props {
  slide: Slide;
  selection: readonly string[];
  /** Layers with a lint problem, and the worst one (D73). */
  issues?: ReadonlyMap<string, LintSeverity>;
  onSelect(ids: string[], additive: boolean): void;
  onHover(id: string | null): void;
}

export function LayersPanel({ slide: live, selection, issues, onSelect, onHover }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  /** Where Shift+click ranges start: the last row clicked without Shift. */
  const anchor = useRef<LayerAnchor | null>(null);
  const { drag, onPointerDown, suppressClick } = useLayerDrag({
    list,
    slide: live,
    selection,
    onSelect,
  });
  // While dragging, show the slide as it was at the press (the canvas shows the preview).
  const slide = drag?.slide ?? live;
  const dragged = new Set(drag?.ids ?? []);
  const indicator = drag?.drop?.indicator;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows: Array<{ node: Node; depth: number }> = [];
  const visit = (node: Node, depth: number) => {
    rows.push({ node, depth });
    if (node.kind === "frame" && !collapsed.has(node.id)) {
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  for (const child of slide.root.children) visit(child, 0);

  const clickRow = (e: React.MouseEvent, id: string) => {
    if (suppressClick.current) return;
    const next = clickLayer(
      rows.map((r) => r.node.id),
      selection,
      anchor.current,
      { id, range: e.shiftKey, toggle: e.ctrlKey || e.metaKey },
    );
    anchor.current = next.anchor;
    onSelect(next.selection, false);
  };

  if (rows.length === 0) {
    return <p className="panel-empty">This slide has no layers yet.</p>;
  }

  return (
    <ul
      ref={list}
      className={`layers${drag ? " is-dragging" : ""}`}
      aria-label="Layers"
      onPointerLeave={() => onHover(null)}
    >
      {rows.map(({ node, depth }, row) => {
        const selected = selection.includes(node.id);
        const label = nodeLabel(node);
        const line = indicator?.kind === "line" && indicator.row === row ? indicator : null;
        const classes = [
          "layer",
          selected && "is-selected",
          node.hidden && "is-hidden",
          dragged.has(node.id) && "is-dragged",
          indicator?.kind === "into" && indicator.row === row && "is-drop-into",
          line && `is-drop-${line.edge}`,
        ];
        return (
          <li
            key={node.id}
            data-layer-id={node.id}
            data-depth={depth}
            className={classes.filter(Boolean).join(" ")}
            style={{
              paddingLeft: ROW_PAD + depth * INDENT,
              ...(line && { "--drop-indent": `${ROW_PAD + line.depth * INDENT + 18}px` }),
            }}
            onPointerEnter={() => !drag && onHover(node.id)}
            onPointerDown={(e) => onPointerDown(e, node.id)}
          >
            {node.kind === "frame" && node.children.length > 0 ? (
              <button
                type="button"
                className="icon-button layer-chevron"
                aria-label={collapsed.has(node.id) ? `Expand ${label}` : `Collapse ${label}`}
                aria-expanded={!collapsed.has(node.id)}
                onClick={() => toggle(node.id)}
              >
                {collapsed.has(node.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="layer-chevron" />
            )}
            <span className="layer-icon" aria-hidden="true">
              <LayerIcon node={node} />
            </span>
            {renaming === node.id ? (
              <RenameInput
                initial={node.name ?? ""}
                placeholder={label}
                onDone={(name) => {
                  setRenaming(null);
                  if (name === null || name === (node.name ?? "")) return;
                  void run(updateNode(node.id, { name: name || null }, "Rename layer"));
                }}
              />
            ) : (
              <button
                type="button"
                className="layer-name"
                aria-pressed={selected}
                onClick={(e) => clickRow(e, node.id)}
                onDoubleClick={() => setRenaming(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "F2") setRenaming(node.id);
                }}
              >
                {label}
              </button>
            )}
            {issues?.has(node.id) && (
              <span
                className={`layer-issue is-${issues.get(node.id)}`}
                role="img"
                aria-label={issues.get(node.id) === "error" ? "Has an error" : "Has a warning"}
                data-tip="See the Issues tab"
              />
            )}
            <span className="layer-actions">
              <button
                type="button"
                className={`icon-button${node.locked ? " is-on" : ""}`}
                aria-label={node.locked ? `Unlock ${label}` : `Lock ${label}`}
                data-tip={node.locked ? "Unlock" : "Lock"}
                onClick={() =>
                  void run(
                    updateNode(
                      node.id,
                      { locked: node.locked ? null : true },
                      node.locked ? "Unlock layer" : "Lock layer",
                    ),
                  )
                }
              >
                {node.locked ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              <button
                type="button"
                className={`icon-button${node.hidden ? " is-on" : ""}`}
                aria-label={node.hidden ? `Show ${label}` : `Hide ${label}`}
                data-tip={node.hidden ? "Show" : "Hide"}
                onClick={() =>
                  void run(
                    updateNode(
                      node.id,
                      { hidden: node.hidden ? null : true },
                      node.hidden ? "Show layer" : "Hide layer",
                    ),
                  )
                }
              >
                {node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const SHAPE_ICONS: Record<string, LucideIcon> = {
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  polygon: Hexagon,
  star: Star,
  arrow: ArrowBigRight,
  chevron: ChevronRight,
};

function LayerIcon({ node }: { node: Node }) {
  if (node.kind === "frame") {
    if (node.layout.mode === "grid") return <LayoutGrid size={14} />;
    if (node.layout.mode === "stack" && node.layout.direction === "row")
      return <Columns3 size={14} />;
    return <Rows3 size={14} />;
  }
  if (node.type === "text") return <Type size={14} />;
  if (node.type === "line")
    return node.props.end && node.props.end !== "none" ? (
      <MoveUpRight size={14} />
    ) : (
      <Slash size={14} />
    );
  if (node.type === "image") return <Image size={14} />;
  if (node.type === "vector") return <PenTool size={14} />;
  if (node.type === "shape") {
    const Icon = SHAPE_ICONS[String(node.props.shape)] ?? Square;
    return <Icon size={14} />;
  }
  return <Square size={14} />;
}

function RenameInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder: string;
  onDone(name: string | null): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="layer-rename"
      aria-label="Layer name"
      // biome-ignore lint/a11y/noAutofocus: the user just asked to rename this layer
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone(null);
        e.stopPropagation();
      }}
    />
  );
}
