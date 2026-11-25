import Link from "next/link";
import { isSitePath, type HomeContent } from "@/lib/storefront/home-content";

/**
 * The banner at the foot of the front page.
 *
 * Copy comes from the database (see `/storefront` in the console); the layout is
 * fixed so an owner cannot break the mobile view by pasting long text. Links are
 * re-checked here as well as on save: a value that arrived any other way (an old
 * row, a manual insert) must never turn into a `javascript:` href.
 */
export function HomeHero({ content }: { content: HomeContent }) {
  const primary = content.primaryHref && isSitePath(content.primaryHref) ? content.primaryHref : null;
  const secondary =
    content.secondaryHref && isSitePath(content.secondaryHref) ? content.secondaryHref : null;

  return (
    <section
      aria-labelledby="home-hero-heading"
      className="overflow-hidden rounded-3xl bg-brand-700 text-white"
    >
      <div className="grid gap-6 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          {content.kicker ? (
            <p className="text-sm font-medium text-brand-200">{content.kicker}</p>
          ) : null}
          <h1
            id="home-hero-heading"
            className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
          >
            {content.heading}
          </h1>
          {content.subheading ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-brand-100">
              {content.subheading}
            </p>
          ) : null}

          {primary || secondary ? (
            <div className="mt-5 flex flex-wrap gap-3">
              {primary && content.primaryLabel ? (
                <Link
                  href={primary}
                  className="inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  {content.primaryLabel}
                </Link>
              ) : null}
              {secondary && content.secondaryLabel ? (
                <Link
                  href={secondary}
                  className="inline-flex min-h-11 items-center rounded-xl border border-brand-300 px-5 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  {content.secondaryLabel}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {content.bullets.length > 0 ? (
          <ul className="grid gap-2 text-sm text-brand-100 sm:grid-cols-2 lg:grid-cols-1">
            {content.bullets.map((bullet) => (
              <li key={bullet} className="rounded-xl bg-brand-800/60 px-3 py-2">
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
