"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  completeMediaUploadAction,
  prepareMediaUploadAction,
  uploadProductMediaAction,
  type CompletedUpload,
  type MediaFormState,
} from "@/app/actions/media";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

type Variants = Array<{ id: string; name: string; sku: string }>;

function SubmitButton({ busy }: { busy?: boolean }) {
  const { pending } = useFormStatus();
  const disabled = pending || busy;
  return (
    <button
      type="submit"
      disabled={disabled}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {disabled ? "Uploading…" : "Upload originals"}
    </button>
  );
}

function Messages({ state }: { state: MediaFormState }) {
  return (
    <>
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-200">
          {state.success}
        </p>
      ) : null}
    </>
  );
}

function FileField({ maxMegabytes }: { maxMegabytes: number }) {
  return (
    <label className="block text-sm font-medium text-ink-700">
      <span>
        Images <span className="text-xs font-normal text-ink-500">ছবি</span>
      </span>
      <input
        type="file"
        name="files"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        required
        className="mt-1 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
      />
      <span className="mt-1 block text-xs font-normal text-ink-500">
        JPEG, PNG, WebP or AVIF · up to {maxMegabytes} MB each · SVG is rejected. Bytes are
        stored exactly as uploaded — never resized, cropped or recompressed.
      </span>
    </label>
  );
}

function MetaFields({ variants }: { variants: Variants }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink-700">
          <span>
            Alt text <span className="text-xs font-normal text-ink-500">বিকল্প লেখা</span>
          </span>
          <input name="altText" maxLength={300} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          <span>
            Variant <span className="text-xs font-normal text-ink-500">ভ্যারিয়েন্ট</span>
          </span>
          <select name="variantId" defaultValue="" className={inputClass}>
            <option value="">All variants</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name} · {variant.sku}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function PrimaryToggle() {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
      <input type="checkbox" name="isPrimary" className="size-4" />
      Make primary
    </label>
  );
}

/** Multipart path: development / self-hosted, where bodies are not capped. */
function ServerActionForm({
  productId,
  variants,
  maxMegabytes,
}: {
  productId: string;
  variants: Variants;
  maxMegabytes: number;
}) {
  const [state, formAction] = useActionState<MediaFormState, FormData>(
    uploadProductMediaAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <Messages state={state} />
      <FileField maxMegabytes={maxMegabytes} />
      <MetaFields variants={variants} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <PrimaryToggle />
      </div>
    </form>
  );
}

/**
 * Direct path: the browser PUTs each original to a short-lived signed URL, so
 * serverless request-body limits never apply. Completion re-reads the object
 * from storage, re-validates it and records the SHA-256 before linking.
 */
function DirectUploadForm({
  productId,
  variants,
  maxBytes,
  maxMegabytes,
}: {
  productId: string;
  variants: Variants;
  maxBytes: number;
  maxMegabytes: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<MediaFormState>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const variantId = typeof data.get("variantId") === "string" ? String(data.get("variantId")) : "";
    const altText = typeof data.get("altText") === "string" ? String(data.get("altText")) : "";
    const isPrimary = data.get("isPrimary") === "on";

    const files = data
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);

    setState({});
    if (files.length === 0) {
      setState({ error: "Choose at least one image." });
      return;
    }
    if (files.length > 8) {
      setState({ error: "Upload at most eight images at a time." });
      return;
    }

    const tooBig = files.find((file) => file.size > maxBytes);
    if (tooBig) {
      setState({ error: `${tooBig.name}: images must be ${maxMegabytes} MB or smaller.` });
      return;
    }
    const wrongType = files.find((file) => !ACCEPTED_TYPES.includes(file.type));
    if (wrongType) {
      setState({
        error: `${wrongType.name}: use a JPEG, PNG, WebP or AVIF image. SVG is refused.`,
      });
      return;
    }

    setBusy(true);
    const completed: CompletedUpload[] = [];
    const failures: string[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgress(`Uploading ${index + 1} of ${files.length}…`);

        const prepared = await prepareMediaUploadAction({
          productId,
          variantId: variantId || null,
          declaredMime: file.type,
          byteSize: file.size,
        });

        if ("error" in prepared) {
          failures.push(`${file.name}: ${prepared.error}`);
          continue;
        }

        const response = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });

        if (!response.ok) {
          failures.push(`${file.name}: storage rejected the upload (${response.status}).`);
          continue;
        }

        completed.push({ key: prepared.key, declaredMime: file.type, filename: file.name });
      }

      if (completed.length === 0) {
        setState({ error: failures[0] ?? "No images were uploaded." });
        return;
      }

      setProgress("Verifying originals…");
      const result = await completeMediaUploadAction({
        productId,
        variantId: variantId || null,
        altText,
        isPrimary,
        uploads: completed,
      });

      if (result.success) {
        setState({
          success: failures.length > 0 ? `${result.success} ${failures.join(" · ")}` : result.success,
        });
        form.reset();
        router.refresh();
      } else {
        setState({
          error: failures.length > 0 ? [result.error, ...failures].filter(Boolean).join(" · ") : result.error,
        });
      }
    } catch (error) {
      console.error("[media] direct upload failed", error);
      setState({ error: "The upload could not be completed. Try again." });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <Messages state={state} />
      {progress ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-ink-600 ring-1 ring-slate-200">
          {progress}
        </p>
      ) : null}
      <FileField maxMegabytes={maxMegabytes} />
      <MetaFields variants={variants} />
      <p className="text-xs text-ink-500">
        Originals upload straight to object storage, so large photos are not blocked by the
        serverless request limit.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={busy} />
        <PrimaryToggle />
      </div>
    </form>
  );
}

export function MediaUploadForm({
  productId,
  variants,
  directUpload = false,
  maxBytes,
}: {
  productId: string;
  variants: Variants;
  /** True when the object store issues signed upload URLs (production). */
  directUpload?: boolean;
  maxBytes?: number;
}) {
  const limit = maxBytes && maxBytes > 0 ? maxBytes : 20 * 1024 * 1024;
  const maxMegabytes = Math.round(limit / (1024 * 1024));

  if (directUpload) {
    return (
      <DirectUploadForm
        productId={productId}
        variants={variants}
        maxBytes={limit}
        maxMegabytes={maxMegabytes}
      />
    );
  }

  return <ServerActionForm productId={productId} variants={variants} maxMegabytes={maxMegabytes} />;
}
