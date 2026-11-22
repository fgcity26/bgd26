"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createPageAction,
  updatePageAction,
  type PageFormState,
} from "@/app/actions/pages";

const inputClass =
  "mt-1 block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-sm font-medium text-ink-700";

export type PageValues = {
  id: string;
  title: string;
  titleBn: string | null;
  slug: string;
  pageType: string;
  excerpt: string | null;
  body: string;
  bodyBn: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  showInHeader: boolean;
  showInFooter: boolean;
  sortOrder: number;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function PageForm({ mode, page }: { mode: "create" | "edit"; page?: PageValues }) {
  const action = mode === "create" ? createPageAction : updatePageAction;
  const [state, formAction] = useActionState<PageFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && page ? <input type="hidden" name="id" value={page.id} /> : null}

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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>
            Title <span className="text-xs font-normal text-ink-500">শিরোনাম</span>
          </span>
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={page?.title ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>
            Bangla title <span className="text-xs font-normal text-ink-500">বাংলা শিরোনাম</span>
          </span>
          <input
            name="titleBn"
            maxLength={200}
            defaultValue={page?.titleBn ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          <span>
            Slug <span className="text-xs font-normal text-ink-500">ইউআরএল</span>
          </span>
          <input
            name="slug"
            maxLength={160}
            placeholder="return-refund"
            defaultValue={page?.slug ?? ""}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-ink-500">
            {mode === "create" ? "Blank uses the title." : "Changing this breaks old links."}
          </span>
        </label>
        <label className={labelClass}>
          <span>
            Page type <span className="text-xs font-normal text-ink-500">ধরন</span>
          </span>
          <select name="pageType" defaultValue={page?.pageType ?? "STATIC"} className={inputClass}>
            <option value="STATIC">Static</option>
            <option value="POLICY">Policy</option>
            <option value="FAQ">FAQ</option>
            <option value="LANDING">Landing</option>
            <option value="BLOG">Blog</option>
          </select>
        </label>
        <label className={labelClass}>
          <span>Sort order</span>
          <input
            name="sortOrder"
            inputMode="numeric"
            defaultValue={page?.sortOrder ?? 0}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>
          Excerpt <span className="text-xs font-normal text-ink-500">সারসংক্ষেপ</span>
        </span>
        <input
          name="excerpt"
          maxLength={500}
          defaultValue={page?.excerpt ?? ""}
          className={inputClass}
        />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className={labelClass}>
          <span>
            Body (English, Markdown) <span className="text-xs font-normal text-ink-500">বিবরণ</span>
          </span>
          <textarea
            name="body"
            required
            rows={14}
            maxLength={60_000}
            placeholder={"## Delivery\n\nWe ship inside Bangladesh within 2–5 working days."}
            defaultValue={page?.body ?? ""}
            className={`${inputClass} font-mono text-xs`}
          />
        </label>
        <label className={labelClass}>
          <span>
            Body (Bangla, Markdown) <span className="text-xs font-normal text-ink-500">বাংলা বিবরণ</span>
          </span>
          <textarea
            name="bodyBn"
            rows={14}
            maxLength={60_000}
            placeholder={"## ডেলিভারি\n\n২–৫ কর্মদিবসের মধ্যে পৌঁছে যাবে।"}
            defaultValue={page?.bodyBn ?? ""}
            className={`${inputClass} font-mono text-xs`}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span>SEO title</span>
          <input
            name="seoTitle"
            maxLength={200}
            defaultValue={page?.seoTitle ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>SEO description</span>
          <input
            name="seoDescription"
            maxLength={400}
            defaultValue={page?.seoDescription ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <legend className="px-1 text-sm font-semibold text-ink-700">Placement</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="showInHeader"
            defaultChecked={page?.showInHeader}
            className="size-4"
          />
          Show in header
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="showInFooter"
            defaultChecked={page?.showInFooter}
            className="size-4"
          />
          Show in footer
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <SubmitButton label={mode === "create" ? "Create draft" : "Save changes"} />
        <p className="text-xs text-ink-500">
          Saved as a draft. Publishing is a separate permission and sets the public URL.
        </p>
      </div>
    </form>
  );
}
