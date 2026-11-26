"use client";

import { useId, useRef, useState } from "react";
import {
  completeStorefrontUploadAction,
  prepareStorefrontUploadAction,
  uploadStorefrontImageAction,
} from "@/app/actions/storefront-home";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * One image slot for the front page: logo, hero background or a banner.
 *
 * The bytes are stored as soon as a file is chosen; the hidden input only
 * carries the resulting asset id, so saving the surrounding form links the
 * image. Nothing is published until that form is saved — picking a file and
 * closing the page leaves the old image visible.
 *
 * Production uploads go straight to object storage with a signed URL. Local
 * development has no signed URLs, so the same field falls back to a server
 * action without changing the UX.
 */
export function StorefrontImageField({
  name,
  label,
  hint,
  initialAssetId,
  initialUrl,
  directUpload,
  aspect = "aspect-[16/5]",
  alt,
}: {
  name: string;
  label: string;
  hint?: string;
  initialAssetId: string | null;
  initialUrl: string | null;
  /** True when the object store issues signed upload URLs (production). */
  directUpload: boolean;
  aspect?: string;
  /** Alt text stored with the asset; defaults to the field label. */
  alt?: string;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [preview, setPreview] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function store(file: File): Promise<{ assetId: string; url: string } | { error: string }> {
    if (directUpload) {
      const prepared = await prepareStorefrontUploadAction({
        declaredMime: file.type,
        byteSize: file.size,
      });
      if ("error" in prepared) return prepared;

      const response = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!response.ok) {
        return { error: `Storage rejected the upload (${response.status}). Try again.` };
      }

      const completed = await completeStorefrontUploadAction({
        key: prepared.key,
        filename: file.name,
        declaredMime: file.type,
        alt: alt ?? label,
      });
      if ("error" in completed) return completed;
      return { assetId: completed.assetId, url: completed.url };
    }

    const data = new FormData();
    data.set("file", file);
    data.set("alt", alt ?? label);
    const completed = await uploadStorefrontImageAction(data);
    if ("error" in completed) return completed;
    return { assetId: completed.assetId, url: completed.url };
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a JPEG, PNG, WebP or AVIF image. SVG is refused.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Images must be 20 MB or smaller.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await store(file);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAssetId(result.assetId);
      setPreview(result.url);
    } catch (uploadError) {
      console.error("[storefront] image upload failed", uploadError);
      setError("The upload could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    setAssetId("");
    setPreview(null);
    setError(null);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}

      {/* The saved value. Empty means "no image" and is valid for every slot. */}
      <input type="hidden" name={name} value={assetId} />

      <div className={`mt-2 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 ${aspect}`}>
        {preview ? (
          // Originals are served untouched; next/image would re-encode them.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={alt ?? label} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center px-4 text-center text-xs text-ink-500">
            {busy ? "Uploading…" : "No image yet — text will be shown on the brand colour."}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Uploading…" : preview ? "Replace image" : "Upload image"}
        </button>
        {preview ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="min-h-10 rounded-xl px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
        <span className="text-xs text-ink-500">JPEG, PNG, WebP or AVIF · up to 20 MB</span>
      </div>

      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={onChange}
        disabled={busy}
        className="sr-only"
      />
    </div>
  );
}
