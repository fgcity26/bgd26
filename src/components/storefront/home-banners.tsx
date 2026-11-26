"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CarouselSlide } from "@/lib/storefront/banners";

/**
 * The front-page banner carousel: six possible slides, one fifth of the screen
 * tall, advancing every ten seconds.
 *
 * Accessibility and battery life come before motion:
 * - `prefers-reduced-motion` turns auto-advance off entirely (the arrows and
 *   dots still work).
 * - hovering or focusing the carousel pauses it, so a CTA never moves away
 *   while someone is reaching for it.
 * - a hidden tab does not rotate in the background.
 *
 * The first slide is server-rendered, so the banner is complete before
 * JavaScript runs; only the rotation needs the client.
 */
export function HomeBanners({
  slides,
  bullets,
  intervalMs = 10_000,
}: {
  slides: CarouselSlide[];
  bullets: string[];
  intervalMs?: number;
}) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const regionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (count < 2 || paused || reduceMotion || hidden) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, hidden, intervalMs, paused, reduceMotion]);

  const current = count > 0 ? Math.min(index, count - 1) : 0;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  if (count === 0) return null;

  return (
    <div className="space-y-3">
      <section
        ref={regionRef}
        aria-roledescription="carousel"
        aria-label="Shop highlights"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPaused(false);
          }
        }}
        className="relative h-[20vh] min-h-[150px] overflow-hidden rounded-3xl bg-brand-700 text-white"
      >
        {slides.map((slide, slideIndex) => {
          const active = slideIndex === current;
          return (
            <article
              key={slide.key}
              role="group"
              aria-roledescription="slide"
              aria-label={`${slideIndex + 1} of ${count}`}
              aria-hidden={!active}
              className={`absolute inset-0 transition-opacity duration-700 ${
                active ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {slide.image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.image.url}
                    alt={slide.image.alt || slide.title}
                    width={slide.image.width ?? 1600}
                    height={slide.image.height ?? 500}
                    loading={slideIndex === 0 ? "eager" : "lazy"}
                    className="absolute inset-0 size-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-slate-950/15" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900">
                  <span
                    aria-hidden
                    className="absolute -right-10 -top-16 size-56 rounded-full bg-white/10"
                  />
                  <span
                    aria-hidden
                    className="absolute -bottom-20 right-16 size-40 rounded-full bg-white/5"
                  />
                </div>
              )}

              <div className="relative flex h-full flex-col justify-center gap-1 px-5 py-4 sm:px-8">
                {slide.kicker ? (
                  <p className="hidden text-xs font-medium text-brand-100 sm:block">
                    {slide.kicker}
                  </p>
                ) : null}
                <h2 className="line-clamp-2 max-w-2xl text-lg font-bold leading-tight tracking-tight sm:text-2xl lg:text-3xl">
                  {slide.title}
                </h2>
                {slide.subtitle ? (
                  <p className="line-clamp-2 hidden max-w-xl text-xs leading-relaxed text-white/85 sm:block sm:text-sm">
                    {slide.subtitle}
                  </p>
                ) : null}
                {slide.linkHref && slide.linkLabel ? (
                  <div className="mt-2">
                    <Link
                      href={slide.linkHref}
                      tabIndex={active ? 0 : -1}
                      className="inline-flex min-h-9 items-center rounded-lg bg-white px-4 text-xs font-semibold text-brand-800 hover:bg-brand-50 sm:text-sm"
                    >
                      {slide.linkLabel}
                    </Link>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {count > 1 ? (
          <>
            <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
              {slides.map((slide, slideIndex) => (
                <button
                  key={slide.key}
                  type="button"
                  onClick={() => go(slideIndex)}
                  aria-label={`Show banner ${slideIndex + 1}`}
                  aria-current={slideIndex === current ? "true" : undefined}
                  className={`size-2.5 rounded-full transition-colors ${
                    slideIndex === current ? "bg-white" : "bg-white/45 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => go(current - 1)}
              aria-label="Previous banner"
              className="absolute left-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-slate-950/30 text-white hover:bg-slate-950/55 sm:left-2"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(current + 1)}
              aria-label="Next banner"
              className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-slate-950/30 text-white hover:bg-slate-950/55 sm:right-2"
            >
              ›
            </button>
          </>
        ) : null}
      </section>

      {bullets.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs text-ink-600">
          {bullets.map((bullet) => (
            <li key={bullet} className="rounded-full bg-slate-100 px-3 py-1.5">
              {bullet}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
