/**
 * An image's crop in the inspector (D84): a button that enters crop mode on the canvas (or
 * leaves it: "Done"), and how much of the picture is kept. Reset shows the whole picture
 * again. The cropping itself happens on the canvas, where the picture is.
 */
import { Crop as CropIcon } from "lucide-react";
import { enterCrop, exitCrop, useCropping } from "../crop-mode.js";
import { cropOf } from "../model/crop.js";
import { Field } from "./fields.js";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function CropField({
  label,
  nodeId,
  value,
  onReset,
}: {
  label: string;
  nodeId: string;
  value: unknown;
  onReset(): void;
}) {
  const cropping = useCropping() === nodeId;
  const crop = cropOf(value);
  return (
    <Field label={label} isSet={value !== undefined} onReset={onReset}>
      <div className="crop-field">
        <button
          type="button"
          className="button"
          aria-pressed={cropping}
          data-tip="Or double-click the image. Enter or Esc when done."
          onClick={() => (cropping ? exitCrop() : enterCrop(nodeId))}
        >
          <CropIcon size={14} /> {cropping ? "Done" : "Crop image"}
        </button>
        {crop && (
          <span className="crop-readout">
            {pct(crop.w)} × {pct(crop.h)} kept
          </span>
        )}
      </div>
    </Field>
  );
}
