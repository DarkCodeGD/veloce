/**
 * An asset prop (an image's picture): a preview with the file's name and size, and "Replace…"
 * to pick another file. The upload goes to the server first; the swap is then one
 * transaction (see `replaceAsset`).
 */
import { assetKind, type Deck, parseAssetRef } from "@veloce/core";
import { ImageUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IMAGE_TYPES, UploadError, uploadAsset } from "../assets.js";
import { assetUrl } from "../editor-context.js";
import type { Imported } from "../model/asset-insert.js";
import { showToast } from "../toasts.js";
import { Field } from "./fields.js";

export function AssetField({
  label,
  value,
  deck,
  onReplace,
}: {
  label: string;
  value: unknown;
  deck: Deck;
  onReplace(next: Imported): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const assetId = parseAssetRef(value);
  const info = assetId ? deck.assets[assetId] : undefined;

  const replace = async (file: File) => {
    setBusy(true);
    try {
      const next = await uploadAsset(deck.id, file, file.name);
      if (assetKind(next.info.mime) !== "image")
        throw new UploadError(`${file.name} isn't an image`);
      onReplace(next);
    } catch (error) {
      const message = error instanceof UploadError ? error.message : "Couldn't upload the file";
      showToast({ message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} htmlFor={id}>
      <div className="asset-field">
        {assetId && info ? (
          <img className="asset-thumb" src={assetUrl(deck.id, assetId)} alt="" />
        ) : (
          <span className="asset-thumb is-missing" />
        )}
        <span className="asset-meta">
          <span className="asset-name">
            {info?.name ?? (info ? "Untitled image" : "Missing file")}
          </span>
          {info?.width && info.height && (
            <span className="asset-size">
              {info.width} × {info.height}
            </span>
          )}
        </span>
        <button
          id={id}
          type="button"
          className="button button-ghost asset-replace"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImageUp size={14} aria-hidden="true" /> {busy ? "Uploading…" : "Replace…"}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept={IMAGE_TYPES}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void replace(file);
          }}
        />
      </div>
    </Field>
  );
}
