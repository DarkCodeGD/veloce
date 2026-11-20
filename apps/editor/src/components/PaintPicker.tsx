/**
 * The paint picker (D66): Figma's fill picker for fills and backgrounds. Tabs across the top
 * pick what the paint is, and each tab edits its own kind:
 *
 *   [■ Solid] [▤ Linear] [◉ Radial] [◔ Angular] [▣ Image]
 *   Solid      the color picker (D64), unchanged
 *   Gradients  a stop bar (click to add, drag to move, drag away or Delete to remove), the
 *              selected stop's position and color (theme swatches + picker), then the angle
 *              (linear, angular) and center (radial, angular)
 *   Image      upload a file or reuse one of the deck's images, and how it fits
 *
 * Switching tabs converts the paint at once (a color fades into a gradient of itself, a
 * gradient keeps its stops), except Image, which waits for a file. Every gesture follows the
 * inspector's contract (D41): drags preview, one release is one undo step.
 */
import { assetKind, type Deck, type Gradient, resolveColor, type Theme } from "@veloce/core";
import { ArrowLeftRight, ImageUp, RotateCwSquare, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { UploadError, uploadAsset } from "../assets.js";
import { assetUrl } from "../editor-context.js";
import { type GradientSession, gradientStore } from "../gradient-edit.js";
import type { Imported } from "../model/asset-insert.js";
import { fromPicked, keepOpacity, pickerColor } from "../model/color.js";
import {
  addStop,
  convertPaint,
  flipStops,
  imagePaint,
  isGradient,
  moveStop,
  PAINT_KINDS,
  type PaintKind,
  paintCss,
  paintKind,
  recolorStop,
  removeStop,
  stopBarCss,
} from "../model/paint.js";
import { showToast } from "../toasts.js";
import { ColorPicker } from "./ColorPicker.js";
import { Swatches } from "./fields.js";
import { useNumberControl } from "./useNumberControl.js";

const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml";
const FITS = [
  { fit: "cover", label: "Cover", tip: "Fill the box, cropping the edges" },
  { fit: "contain", label: "Fit", tip: "Show it whole, inside the box" },
  { fit: "fill", label: "Stretch", tip: "Stretch it to the box" },
  { fit: "tile", label: "Tile", tip: "Repeat it at its own size" },
] as const;
/** Pixels a stop is dragged away from the bar before letting go removes it (like Figma). */
const REMOVE_DISTANCE = 32;

export interface PaintPickerProps {
  /** Names the controls for screen readers ("Fill stop hue"). */
  label: string;
  value: unknown;
  theme: Theme;
  deck: Pick<Deck, "id" | "assets">;
  /** The color a gradient starts from when there's no color (nothing set, an image). */
  fallback: string;
  /** The layer or slide being painted: a gradient gets handles there on the canvas (D87). */
  owner?: string | undefined;
  /** The Solid tab's body: the field's own color picker. */
  children: ReactNode;
  onPreview(paint: unknown | null): void;
  /** One change; `imported` is a file uploaded for it (registered in the same step). */
  onCommit(paint: unknown, imported?: Imported): void;
}

export function PaintPicker(props: PaintPickerProps) {
  const { label, value, fallback, onCommit } = props;
  const kind = paintKind(value);
  // Image is a tab you can be on before the paint is one (choosing the file).
  const [tab, setTab] = useState<PaintKind>(kind);
  useEffect(() => setTab(kind), [kind]);

  const choose = (to: PaintKind) => {
    setTab(to);
    if (to !== "image" && to !== kind) onCommit(convertPaint(value, to, fallback));
  };

  return (
    <div className="paint-picker">
      <div className="paint-tabs" role="tablist" aria-label={`${label} paint`}>
        {PAINT_KINDS.map(({ kind: k, label: name }) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-label={name}
            data-tip={name === "Angular" ? "Angular (conic)" : name}
            onClick={() => choose(k)}
          >
            <span className={`paint-tab-icon is-${k}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={PAINT_KINDS.find((k) => k.kind === tab)?.label}>
        {tab === "solid" && props.children}
        {tab !== "solid" && tab !== "image" && isGradient(value) && (
          <GradientEditor {...props} gradient={value} />
        )}
        {tab === "image" && <ImageEditor {...props} />}
      </div>
    </div>
  );
}

// ── Gradients ───────────────────────────────────────────────────────────────────────────

function GradientEditor({
  label,
  gradient,
  theme,
  owner,
  onPreview,
  onCommit,
}: PaintPickerProps & { gradient: Gradient }) {
  const [selected, setSelected] = useState(0);
  /** The gradient being dragged on the bar (the document only changes on release). */
  const [draft, setDraft] = useState<Gradient | null>(null);
  const shown = draft ?? gradient;
  const index = Math.min(selected, shown.stops.length - 1);
  const stop = shown.stops[index] ?? shown.stops[0];
  // Share what's shown with the canvas, which draws handles for it (D87); withdraw it when
  // the picker closes or leaves the gradient.
  const session = useRef<GradientSession | null>(null);
  useLayoutEffect(() => {
    if (!owner) return;
    session.current = {
      owner,
      gradient: shown,
      theme,
      selected: index,
      select: setSelected,
      preview: (next) => onPreview(next),
      commit: (next, nextIndex) => {
        setSelected(nextIndex);
        onCommit(next);
      },
    };
    gradientStore.set(session.current);
  });
  useEffect(
    () => () => {
      if (gradientStore.get() === session.current) gradientStore.set(null);
    },
    [],
  );
  if (!stop) return null;

  const commit = (next: Gradient, nextIndex = index) => {
    setSelected(nextIndex);
    onCommit(next);
  };
  const stopColor = pickerColor(resolveColor(theme, stop.color), stop.color);
  const recolor = (picked: { hex: string; alpha: number }) =>
    recolorStop(gradient, index, fromPicked(stop.color, stopColor.hex, picked));
  // Linear and angular gradients have an angle, radial and angular ones a center.
  const angle =
    gradient.type === "radial-gradient"
      ? null
      : (gradient.angle ?? (gradient.type === "linear-gradient" ? 180 : 0));
  const center =
    gradient.type === "linear-gradient" ? null : (gradient.center ?? { x: 0.5, y: 0.5 });
  const withAngle = (deg: number) => ({ ...gradient, angle: deg % 360 }) as Gradient;
  const withCenter = (axis: "x" | "y", pct: number) =>
    ({ ...gradient, center: { ...center, [axis]: pct / 100 } }) as Gradient;
  const remove = () => {
    const next = removeStop(gradient, index);
    if (next) commit(next, Math.max(0, index - 1));
  };

  return (
    <div className="paint-gradient">
      <StopBar
        label={label}
        gradient={shown}
        theme={theme}
        selected={index}
        onSelect={setSelected}
        onDraft={(next) => {
          setDraft(next);
          onPreview(next);
        }}
        onCommit={(next, nextIndex) => {
          setDraft(null);
          if (next) commit(next, nextIndex);
          else onPreview(null);
        }}
      />
      <div className="paint-row">
        <PercentBox
          label={`${label} stop position`}
          short="Stop"
          suffix="%"
          value={Math.round(stop.offset * 100)}
          max={100}
          onPreview={(pct) =>
            onPreview(pct === null ? null : moveStop(gradient, index, pct / 100).gradient)
          }
          onCommit={(pct) => {
            const moved = moveStop(gradient, index, (pct ?? 0) / 100);
            commit(moved.gradient, moved.index);
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${label}: remove stop`}
          data-tip="Remove stop (Delete)"
          disabled={gradient.stops.length <= 2}
          onClick={remove}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`${label}: flip gradient`}
          data-tip="Flip"
          onClick={() => commit(flipStops(gradient), gradient.stops.length - 1 - index)}
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="paint-row">
        {angle !== null && (
          <>
            <PercentBox
              label={`${label} angle`}
              short="Angle"
              suffix="°"
              value={Math.round(angle)}
              max={360}
              onPreview={(deg) => onPreview(deg === null ? null : withAngle(deg))}
              onCommit={(deg) => commit(withAngle(deg ?? 0))}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`${label}: rotate 90°`}
              data-tip="Rotate 90°"
              onClick={() => commit(withAngle(Math.round(angle) + 90))}
            >
              <RotateCwSquare size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div className="paint-row">
        {center !== null && <span className="paint-number-label">Center</span>}
        {center !== null &&
          (["x", "y"] as const).map((axis) => (
            <PercentBox
              key={axis}
              label={`${label} center ${axis}`}
              short={axis.toUpperCase()}
              suffix="%"
              value={Math.round(center[axis] * 100)}
              max={100}
              onPreview={(pct) => onPreview(pct === null ? null : withCenter(axis, pct))}
              onCommit={(pct) => commit(withCenter(axis, pct ?? 50))}
            />
          ))}
      </div>
      <Swatches
        theme={theme}
        label={`${label} stop`}
        value={stop.color}
        onPick={(token) => commit(recolorStop(gradient, index, keepOpacity(stop.color, token)))}
      />
      <ColorPicker
        label={`${label} stop`}
        value={stopColor}
        onPreview={(picked) => onPreview(recolor(picked))}
        onCommit={(picked) => {
          const next = recolor(picked);
          if (next.stops[index]?.color !== stop.color) commit(next);
          else onPreview(null);
        }}
      />
    </div>
  );
}

/**
 * The gradient's stops on a bar. Press the bar to add a stop there; drag a stop to move it
 * (past its neighbours too), or away from the bar to remove it. Each stop is a slider for the
 * keyboard: ←/→ move it (Shift ×10), Delete removes it.
 */
function StopBar({
  label,
  gradient,
  theme,
  selected,
  onSelect,
  onDraft,
  onCommit,
}: {
  label: string;
  gradient: Gradient;
  theme: Theme;
  selected: number;
  onSelect(index: number): void;
  /** While dragging: the gradient as it would be. */
  onDraft(gradient: Gradient): void;
  /** The drag ended: the result (null: nothing changed) and where the dragged stop is. */
  onCommit(gradient: Gradient | null, index: number): void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    base: Gradient;
    index: number;
    result: Gradient | null;
    at: number;
    removing: boolean;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const offsetAt = (clientX: number) => {
    const r = rail.current?.getBoundingClientRect();
    return r && r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-stop]");
    if (!handle) {
      // The bar itself: a new stop where it was pressed.
      e.preventDefault();
      const added = addStop(gradient, offsetAt(e.clientX), theme);
      if (added) onCommit(added.gradient, added.index);
      return;
    }
    const index = Number(handle.dataset.stop);
    handle.focus();
    onSelect(index);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { base: gradient, index, result: null, at: index, removing: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const away = e.clientY < r.top - REMOVE_DISTANCE || e.clientY > r.bottom + REMOVE_DISTANCE;
    const removed = away ? removeStop(d.base, d.index) : null;
    if (removed) {
      d.result = removed;
      d.at = Math.max(0, d.index - 1);
      d.removing = true;
      setRemoving(true);
      onDraft(removed);
      return;
    }
    const moved = moveStop(d.base, d.index, offsetAt(e.clientX));
    d.result = moved.gradient;
    d.at = moved.index;
    d.removing = false;
    setRemoving(false);
    onSelect(moved.index);
    onDraft(moved.gradient);
  };

  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setRemoving(false);
    onCommit(d.result, d.at);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const stop = gradient.stops[index];
    if (!stop) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation(); // not a layer nudge
      const moved = moveStop(gradient, index, stop.offset + (e.key === "ArrowLeft" ? -step : step));
      onCommit(moved.gradient, moved.index);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation(); // not "delete the layer"
      const next = removeStop(gradient, index);
      if (next) onCommit(next, Math.max(0, index - 1));
    }
  };

  return (
    <fieldset className="paint-stops" aria-label={`${label} gradient stops`}>
      <div
        ref={rail}
        className="paint-stop-rail"
        style={{ "--bar": stopBarCss(gradient, theme) } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onLostPointerCapture={end}
      >
        {gradient.stops.map((s, i) => (
          <button
            // Stops have no IDs; position in the sorted list is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            type="button"
            data-stop={i}
            role="slider"
            aria-label={`${label} stop ${i + 1}`}
            aria-valuenow={Math.round(s.offset * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${Math.round(s.offset * 100)}%`}
            className={`paint-stop${i === selected ? " is-selected" : ""}${i === selected && removing ? " is-removing" : ""}`}
            style={
              {
                left: `${s.offset * 100}%`,
                "--stop": resolveColor(theme, s.color) ?? "transparent",
              } as React.CSSProperties
            }
            onKeyDown={(e) => onKeyDown(e, i)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** A small number box with a scrubbable label ("Angle 135°"), 0 to `max`. */
function PercentBox({
  label,
  short,
  suffix,
  value,
  max,
  onPreview,
  onCommit,
}: {
  label: string;
  short: string;
  suffix: string;
  value: number;
  max: number;
  onPreview(value: number | null): void;
  onCommit(value: number | null): void;
}) {
  const control = useNumberControl({
    value,
    min: 0,
    max,
    integer: true,
    onPreview,
    onCommit: (n) => {
      if (n !== null) onCommit(n);
      else onPreview(null);
    },
  });
  return (
    <div className="paint-number">
      <span
        className={`paint-number-label is-scrubbable${control.scrubbing ? " is-scrubbing" : ""}`}
        {...control.labelProps}
      >
        {short}
      </span>
      <div className="input-with-suffix">
        <input aria-label={label} {...control.inputProps} />
        <span className="suffix">{suffix}</span>
      </div>
    </div>
  );
}

// ── Images ──────────────────────────────────────────────────────────────────────────────

function ImageEditor({ label, value, theme, deck, onCommit }: PaintPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const current = paintKind(value) === "image" ? (value as { asset: string; fit?: string }) : null;
  const currentId = current?.asset.slice("asset:".length);
  const images = Object.entries(deck.assets).filter(([, info]) => assetKind(info.mime) === "image");
  const url = (id: string) => assetUrl(deck.id, id);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const next = await uploadAsset(deck.id, file, file.name);
      if (assetKind(next.info.mime) !== "image") {
        throw new UploadError(`${file.name} isn't an image`);
      }
      onCommit(imagePaint(next.id, value), next);
    } catch (error) {
      const message = error instanceof UploadError ? error.message : "Couldn't upload the file";
      showToast({ message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paint-image">
      <div
        className={`paint-image-preview${current ? "" : " is-empty"}`}
        style={current ? { background: paintCss(value, theme, url) } : undefined}
      >
        {!current && <span>No image yet</span>}
      </div>
      <fieldset className="paint-fits" aria-label={`${label} image fit`}>
        {FITS.map(({ fit, label: name, tip }) => (
          <button
            key={fit}
            type="button"
            aria-pressed={(current?.fit ?? "cover") === fit && current !== null}
            data-tip={tip}
            disabled={!current}
            onClick={() => current && onCommit({ ...current, fit })}
          >
            {name}
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        className="button button-ghost paint-upload"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <ImageUp size={14} aria-hidden="true" /> {busy ? "Uploading…" : "Upload image…"}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={IMAGE_TYPES}
        aria-label={`${label}: image file`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {images.length > 0 && (
        <fieldset className="paint-image-grid" aria-label="Images in this deck">
          {images.map(([id, info]) => (
            <button
              key={id}
              type="button"
              className={`paint-image-option${id === currentId ? " is-on" : ""}`}
              aria-label={`Use image ${info.name ?? "untitled"}`}
              aria-pressed={id === currentId}
              data-tip={info.name ?? "Untitled image"}
              onClick={() => id !== currentId && onCommit(imagePaint(id, value))}
            >
              <img src={url(id)} alt="" />
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
