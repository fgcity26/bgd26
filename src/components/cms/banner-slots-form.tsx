"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveBannersAction, type HomeContentState } from "@/app/actions/storefront-home";
import { StorefrontImageField } from "@/components/cms/storefront-image-field";
import type { StorefrontBanner } from "@/lib/storefront/banners";

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
      {pending ? "Saving…" : "Save banners"}
    </button>
  );
}

function SlotCard({
  banner,
  directUpload,
  canWrite,
}: {
  banner: StorefrontBanner;
  directUpload: boolean;
  canWrite: boolean;
}) {
  const slot = banner.slot;
  return (
    <fieldset
      disabled={!canWrite}
      className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
    >
      <legend className="px-1 text-sm font-semibold text-ink-900">
        Banner {slot} · slide {slot} of 6
      </legend>

      <StorefrontImageField
        name={`banner-${slot}-image`}
        label="Photo"
        hint="Wide images work best — the slide is 20% of the screen tall."
        initialAssetId={banner.image?.assetId ?? null}
        initialUrl={banner.image?.url ?? null}
        directUpload={directUpload}
        aspect="aspect-[16/5]"
        alt={banner.title || `Banner ${slot}`}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`banner-${slot}-title`} className={labelClass}>
            Title · শিরোনাম
          </label>
          <input
            id={`banner-${slot}-title`}
            name={`banner-${slot}-title`}
            maxLength={80}
            defaultValue={banner.title}
            className={inputClass}
            placeholder="Engraved gifts for every occasion"
          />
        </div>
        <div>
          <label htmlFor={`banner-${slot}-subtitle`} className={labelClass}>
            Short line · ছোট বর্ণনা
          </label>
          <input
            id={`banner-${slot}-subtitle`}
            name={`banner-${slot}-subtitle`}
            maxLength={160}
            defaultValue={banner.subtitle}
            className={inputClass}
            placeholder="Wood, acrylic and photo gifts made in Dhaka"
          />
        </div>
        <div>
          <label htmlFor={`banner-${slot}-linkLabel`} className={labelClass}>
            Button label
          </label>
          <input
            id={`banner-${slot}-linkLabel`}
            name={`banner-${slot}-linkLabel`}
            maxLength={40}
            defaultValue={banner.linkLabel}
            className={inputClass}
            placeholder="See the gifts"
          />
        </div>
        <div>
          <label htmlFor={`banner-${slot}-linkHref`} className={labelClass}>
            Button link
          </label>
          <input
            id={`banner-${slot}-linkHref`}
            name={`banner-${slot}-linkHref`}
            maxLength={200}
            defaultValue={banner.linkHref}
            className={inputClass}
            placeholder="/shop"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          name={`banner-${slot}-active`}
          defaultChecked={banner.isActive}
          className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        Show this banner in the carousel
      </label>
    </fieldset>
  );
}

/**
 * Slides 2–6. Slide 1 is the hero copy above, so the carousel always has a
 * banner even before a photo is uploaded. Empty slots are skipped; a cleared
 * slot keeps its row but stays off, so nothing is hard-deleted.
 */
export function BannerSlotsForm({
  banners,
  directUpload,
  canWrite,
}: {
  banners: StorefrontBanner[];
  directUpload: boolean;
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<HomeContentState, FormData>(
    saveBannersAction,
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

      <p className="text-sm text-ink-500">
        Slide 1 is the hero at the top of this screen. These five slots follow it, so the
        carousel holds six banners. It advances every 10 seconds and pauses when someone
        hovers or focuses it.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {banners.map((banner) => (
          <SlotCard
            key={banner.slot}
            banner={banner}
            directUpload={directUpload}
            canWrite={canWrite}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton disabled={!canWrite} />
        <p className="text-xs text-ink-500">
          Links must stay on this shop and start with <code>/</code>. A banner with no
          title and no photo is skipped even if it is ticked.
        </p>
      </div>
    </form>
  );
}
