"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveBrandingAction, type HomeContentState } from "@/app/actions/storefront-home";
import { StorefrontImageField } from "@/components/cms/storefront-image-field";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save logo"}
    </button>
  );
}

/**
 * Header brand: an uploaded mark plus the wordmark beside it.
 *
 * Kept separate from the banner copy so changing a logo cannot overwrite a
 * half-finished headline edit. Removing the image restores the letter badge.
 */
export function BrandForm({
  logoAssetId,
  logoUrl,
  logoText,
  directUpload,
  canWrite,
}: {
  logoAssetId: string | null;
  logoUrl: string | null;
  logoText: string;
  directUpload: boolean;
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<HomeContentState, FormData>(
    saveBrandingAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
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

      <fieldset className="space-y-4" disabled={!canWrite}>
        <legend className="text-sm font-semibold text-ink-900">Shop logo · দোকানের লোগো</legend>

        <StorefrontImageField
          name="logoAssetId"
          label="Logo image"
          hint="Shown in the shop header on every page. A wide or square PNG with a transparent background works best."
          initialAssetId={logoAssetId}
          initialUrl={logoUrl}
          directUpload={directUpload}
          aspect="aspect-[4/1]"
          alt="Shop logo"
        />

        <div>
          <label htmlFor="logoText" className={labelClass}>
            Shop name · দোকানের নাম
          </label>
          <input
            id="logoText"
            name="logoText"
            maxLength={40}
            defaultValue={logoText}
            className={inputClass}
            placeholder="bgd26"
          />
          <p className="mt-1 text-xs text-ink-500">
            Shown beside the logo and in the footer. Leave empty to show the image only.
          </p>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton disabled={!canWrite} />
        <p className="text-xs text-ink-500">
          No image means the green letter badge is used, so the header never looks empty.
        </p>
      </div>
    </form>
  );
}
