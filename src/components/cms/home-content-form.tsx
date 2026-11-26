"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveHomeContentAction, type HomeContentState } from "@/app/actions/storefront-home";
import { StorefrontImageField } from "@/components/cms/storefront-image-field";
import type { HomeEditorContent } from "@/lib/storefront/home-content";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

const hintClass = "mt-1 text-xs text-ink-500";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save hero banner"}
    </button>
  );
}

const BULLET_SLOTS = 4;

export function HomeContentForm({
  content,
  directUpload,
  canWrite,
}: {
  content: HomeEditorContent;
  directUpload: boolean;
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<HomeContentState, FormData>(
    saveHomeContentAction,
    {},
  );

  const bullets = Array.from(
    { length: BULLET_SLOTS },
    (_, index) => content.bullets[index] ?? "",
  );

  return (
    <form action={formAction} className="space-y-6">
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
        <legend className="text-sm font-semibold text-ink-900">
          Slide 1 · hero banner · প্রথম ব্যানার
        </legend>

        <StorefrontImageField
          name="heroImageAssetId"
          label="Hero background photo (optional)"
          hint="Shown behind this slide. Without a photo the slide uses the brand gradient."
          initialAssetId={content.heroImageAssetId}
          initialUrl={content.heroImage?.url ?? null}
          directUpload={directUpload}
          aspect="aspect-[16/5]"
          alt={content.heading}
        />

        <div>
          <label htmlFor="kicker" className={labelClass}>
            Small line above the title · উপরের ছোট লাইন
          </label>
          <input
            id="kicker"
            name="kicker"
            maxLength={60}
            defaultValue={content.kicker}
            className={inputClass}
            placeholder="বাংলাদেশে ডেলিভারি"
          />
          <p className={hintClass}>Leave empty for no small line.</p>
        </div>

        <div>
          <label htmlFor="heading" className={labelClass}>
            Hero title · হিরো শিরোনাম
          </label>
          <input
            id="heading"
            name="heading"
            required
            maxLength={120}
            defaultValue={content.heading}
            className={inputClass}
          />
          <p className={hintClass}>The largest line in the first banner. Keep it under 80 characters.</p>
        </div>

        <div>
          <label htmlFor="subheading" className={labelClass}>
            Paragraph · বর্ণনা
          </label>
          <textarea
            id="subheading"
            name="subheading"
            rows={3}
            maxLength={400}
            defaultValue={content.subheading}
            className={inputClass}
          />
          <p className={hintClass}>Two short sentences read best on a phone.</p>
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={!canWrite}>
        <legend className="text-sm font-semibold text-ink-900">
          Buttons · বাটন
        </legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="primaryLabel" className={labelClass}>
              First button label
            </label>
            <input
              id="primaryLabel"
              name="primaryLabel"
              maxLength={40}
              defaultValue={content.primaryLabel}
              className={inputClass}
              placeholder="Start shopping"
            />
          </div>
          <div>
            <label htmlFor="primaryHref" className={labelClass}>
              First button link
            </label>
            <input
              id="primaryHref"
              name="primaryHref"
              maxLength={200}
              defaultValue={content.primaryHref}
              className={inputClass}
              placeholder="/shop"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="secondaryLabel" className={labelClass}>
              Second button label
            </label>
            <input
              id="secondaryLabel"
              name="secondaryLabel"
              maxLength={40}
              defaultValue={content.secondaryLabel}
              className={inputClass}
              placeholder="Track an order"
            />
          </div>
          <div>
            <label htmlFor="secondaryHref" className={labelClass}>
              Second button link
            </label>
            <input
              id="secondaryHref"
              name="secondaryHref"
              maxLength={200}
              defaultValue={content.secondaryHref}
              className={inputClass}
              placeholder="/track"
            />
          </div>
        </div>

        <p className={hintClass}>
          Links must stay on this shop and start with <code>/</code>. Clear a label to
          hide that button.
        </p>
      </fieldset>

      <fieldset className="space-y-3" disabled={!canWrite}>
        <legend className="text-sm font-semibold text-ink-900">
          Trust points under the carousel · সুবিধা
        </legend>
        <p className={hintClass}>
          Up to four short chips shown below the banners: delivery, payment, coverage,
          updates. Empty slots are ignored.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {bullets.map((value, index) => (
            <div key={index}>
              <label htmlFor={`bullet-${index}`} className={labelClass}>
                Point {index + 1}
              </label>
              <input
                id={`bullet-${index}`}
                name="bullets"
                maxLength={60}
                defaultValue={value}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton disabled={!canWrite} />
        {canWrite ? (
          <p className="text-xs text-ink-500">
            Saving publishes immediately. The shop revalidates within about a minute at
            the latest.
          </p>
        ) : (
          <p className="text-xs text-ink-500">
            You can read this screen, but changing it needs the content-write permission.
          </p>
        )}
      </div>
    </form>
  );
}
