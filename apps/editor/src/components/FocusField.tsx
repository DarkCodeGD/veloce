/**
 * An image's focus point (D82): the picture with a dot on it. Drag the dot (or click anywhere
 * on the picture) to choose what stays in view when the layer crops it. The part the layer
 * shows right now is lit, the cropped-away rest dimmed, so you see the result while you drag;
 * the slide previews it live too, and releasing commits ONE transaction.
 *
 * Keyboard: the dot is a slider. Arrows move it 1% (Shift: 10%), committed when the key is
 * released; Esc puts it back.
 */
import { type Deck, parseAssetRef } from "@veloce/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { assetUrl } from "../editor-context.js";
import {
  crops,
  type Focus,
  focusAt,
  focusOf,
  focusText,
  nudgeFocus,
  type Size,
  visibleCrop,
} from "../model/focus-point.js";
import { mainCanvasSpace } from "./canvas-space.js";
import { Field } from "./fields.js";

const pct = (v: number) => `${v * 100}%`;

export function FocusField({
  label,
  value,
  deck,
  nodeId,
  asset,
  fit,
  onPreview,
  onCommit,
  onReset,
}: {
  label: string;
  /** The stored `{ x, y }`, if set (the centre otherwise). */
  value: unknown;
  deck: Deck;
  nodeId: string;
  /** The element's picture (`"asset:<sha256>"`). */
  asset: unknown;
  /** The element's fit: only `cover` (the default) crops, so only then is a crop shown. */
  fit: string | undefined;
  onPreview(value: Focus | null): void;
  onCommit(value: Focus): void;
  onReset(): void;
}) {
  const assetId = parseAssetRef(asset);
  const info = assetId ? deck.assets[assetId] : undefined;
  const [natural, setNatural] = useState<Size | null>(null);
  const image: Size | null =
    info?.width && info.height ? { w: info.width, h: info.height } : natural;
  const stored = focusOf(value);
  /** Where the dot is while dragging or nudging, before it's committed. */
  const [draft, setDraft] = useState<Focus | null>(null);
  const shown = draft ?? stored;
  const dragging = useRef(false);
  const img = useRef<HTMLImageElement>(null);
  const dot = useRef<HTMLDivElement>(null);

  // The layer's size on the slide decides how much is cropped: measured after each render.
  const [box, setBox] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const size = mainCanvasSpace()?.size(nodeId);
    if (size && (size.w !== box?.w || size.h !== box?.h)) setBox(size);
  });

  // The committed value arrived (ours or anyone's): show it, not the draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compare the numbers, not the object
  useEffect(() => setDraft(null), [stored.x, stored.y]);

  const preview = (focus: Focus) => {
    setDraft(focus);
    onPreview(focus);
  };
  const commit = (focus: Focus) => {
    if (value !== undefined && focus.x === stored.x && focus.y === stored.y) return cancel();
    if (value === undefined && focus.x === 0.5 && focus.y === 0.5) return cancel(); // the default
    onCommit(focus); // the draft stays until the change comes back, so the dot doesn't jump
  };
  const cancel = () => {
    dragging.current = false;
    setDraft(null);
    onPreview(null);
  };
  const at = (e: React.PointerEvent) => {
    const rect = img.current?.getBoundingClientRect();
    return rect ? focusAt({ x: e.clientX, y: e.clientY }, rect) : shown;
  };

  const crop = (fit ?? "cover") === "cover" && image && box ? visibleCrop(image, box, shown) : null;
  const src = assetId && info ? assetUrl(deck.id, assetId) : null;

  return (
    <Field label={label} isSet={value !== undefined} onReset={onReset}>
      <div className="focus-field">
        {src ? (
          <div
            className="focus-pad"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              dot.current?.focus();
              preview(at(e));
            }}
            onPointerMove={(e) => dragging.current && preview(at(e))}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              dragging.current = false;
              commit(at(e));
            }}
            onLostPointerCapture={() => dragging.current && cancel()}
          >
            {/* Clipped: the dimming stays on the picture, while the dot may overhang its edge. */}
            <div className="focus-image">
              <img
                ref={img}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              />
              {crop && crops(crop) && (
                <div
                  className="focus-crop"
                  style={{
                    left: pct(crop.x),
                    top: pct(crop.y),
                    width: pct(crop.w),
                    height: pct(crop.h),
                  }}
                />
              )}
            </div>
            <div
              ref={dot}
              className="focus-dot"
              role="slider"
              tabIndex={0}
              aria-label={`${label} point`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(shown.x * 100)}
              aria-valuetext={focusText(shown)}
              style={{ left: pct(shown.x), top: pct(shown.y) }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && (draft || dragging.current)) {
                  e.preventDefault();
                  e.stopPropagation(); // not the editor's "select parent"
                  return cancel();
                }
                const next = nudgeFocus(shown, e.key, e.shiftKey);
                if (!next) return;
                e.preventDefault();
                e.stopPropagation(); // arrows move the dot, not the layer
                preview(next);
              }}
              onKeyUp={(e) => {
                if (draft && !dragging.current && e.key.startsWith("Arrow")) commit(draft);
              }}
            />
          </div>
        ) : (
          <span className="inspector-hint">No picture yet.</span>
        )}
        <span className="focus-readout">
          {Math.round(shown.x * 100)}% · {Math.round(shown.y * 100)}%
          {crop && !crops(crop) && <span> · nothing cropped at this size</span>}
        </span>
      </div>
    </Field>
  );
}
