import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import {
  moderateReviewAction,
  removeReviewPhotoAction,
} from "@/app/actions/reviews";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { formatBdMobile } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Reviews",
  robots: { index: false, follow: false },
};

const STATUS_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "HIDDEN"] as const;

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function statusStyle(status: string): string {
  if (status === "APPROVED") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (status === "PENDING") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "REJECTED") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-100 text-ink-500 ring-slate-200";
}

function stars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; rating?: string }>;
}) {
  const session = await requirePagePermission("review.read");
  const canModerate = hasPermission(session, "review.approve");
  const canWrite = hasPermission(session, "review.write");

  const params = await searchParams;
  const status = STATUS_OPTIONS.includes(params.status as (typeof STATUS_OPTIONS)[number])
    ? (params.status as (typeof STATUS_OPTIONS)[number])
    : "PENDING";
  const rating = Number(params.rating);
  const ratingFilter = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;

  const where: Prisma.ProductReviewWhereInput = {
    status,
    ...(ratingFilter ? { rating: ratingFilter } : {}),
  };

  const [counts, reviews] = await Promise.all([
    prisma.productReview.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.productReview.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        product: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, fullName: true, mobileNormalized: true } },
        media: {
          orderBy: { sortOrder: "asc" },
          include: {
            mediaAsset: {
              select: { id: true, storageKey: true, altText: true, width: true, height: true },
            },
          },
        },
        moderatedBy: { select: { fullName: true } },
      },
    }),
  ]);

  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
          <p className="mt-1 text-sm text-ink-500">
            রিভিউ যাচাই ও অনুমোদন। অনুমোদনের আগে কিছুই প্রকাশ্যে যায় না।
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/reviews/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Record a review · রিভিউ লিখুন
          </Link>
        ) : null}
      </header>

      <form
        method="get"
        className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[auto_auto_auto]"
      >
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} ({countByStatus.get(option) ?? 0})
            </option>
          ))}
        </select>
        <select
          name="rating"
          defaultValue={ratingFilter ? String(ratingFilter) : ""}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">Any rating</option>
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} stars
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-xs text-ink-500">
        {reviews.length} {status.toLowerCase()} review{reviews.length === 1 ? "" : "s"}
        {reviews.length === 100 ? " (showing the first 100)" : ""}
      </p>

      {reviews.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-medium text-ink-700">Nothing here.</p>
          <p className="mt-1 text-sm text-ink-500">এই অবস্থায় কোনো রিভিউ নেই।</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">
                    <Link href={`/products/${review.product.id}`} className="hover:underline">
                      {review.product.name}
                    </Link>
                  </p>
                  <p className="text-xs text-ink-500">
                    {review.customer.fullName} ·{" "}
                    {formatBdMobile(review.customer.mobileNormalized)} ·{" "}
                    {dateTime.format(review.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {review.isVerifiedPurchase ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                      Verified purchase
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle(review.status)}`}
                  >
                    {review.status}
                  </span>
                </div>
              </div>

              <p className="mt-2 text-sm text-amber-600" aria-label={`${review.rating} out of 5`}>
                {stars(review.rating)}
              </p>
              {review.title ? (
                <p className="mt-1 text-sm font-medium text-ink-900">{review.title}</p>
              ) : null}
              <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{review.body}</p>

              {review.media.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {review.media.map((photo) => (
                    <li key={photo.id} className="w-24">
                      <a
                        href={`/media/${photo.mediaAsset.storageKey}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg ring-1 ring-slate-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/media/${photo.mediaAsset.storageKey}`}
                          alt={photo.mediaAsset.altText ?? "Review photo"}
                          width={photo.mediaAsset.width ?? 96}
                          height={photo.mediaAsset.height ?? 96}
                          loading="lazy"
                          decoding="async"
                          className="h-24 w-full object-cover"
                        />
                      </a>
                      {canModerate ? (
                        <form action={removeReviewPhotoAction} className="mt-1">
                          <input type="hidden" name="id" value={photo.id} />
                          <input type="hidden" name="reviewId" value={review.id} />
                          <button
                            type="submit"
                            className="min-h-8 w-full rounded-lg border border-slate-300 text-[11px] font-medium text-ink-700 hover:border-red-300 hover:text-red-700"
                          >
                            Remove photo
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {review.status === "REJECTED" && review.rejectionReason ? (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  Reason: {review.rejectionReason}
                </p>
              ) : null}

              {review.moderatedBy && review.moderatedAt ? (
                <p className="mt-2 text-xs text-ink-500">
                  Moderated by {review.moderatedBy.fullName} ·{" "}
                  {dateTime.format(review.moderatedAt)}
                </p>
              ) : null}

              {canModerate ? (
                <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-3">
                  {review.status !== "APPROVED" ? (
                    <form action={moderateReviewAction}>
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="APPROVED" />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Approve
                      </button>
                    </form>
                  ) : null}

                  {review.status !== "HIDDEN" ? (
                    <form action={moderateReviewAction}>
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="HIDDEN" />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300"
                      >
                        Hide
                      </button>
                    </form>
                  ) : null}

                  {review.status !== "REJECTED" ? (
                    <form action={moderateReviewAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="REJECTED" />
                      <input
                        name="reason"
                        maxLength={500}
                        placeholder="Reason (optional)"
                        className="min-h-9 w-52 rounded-lg border border-slate-300 px-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Reject
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
