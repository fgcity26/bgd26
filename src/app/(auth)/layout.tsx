import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white"
        >
          b
        </span>
        <span className="text-lg font-semibold tracking-tight">bgd26</span>
      </div>
      {children}
      <p className="mt-8 text-center text-xs text-ink-500">
        <Link href="/" className="underline-offset-2 hover:text-brand-700 hover:underline">
          ← Back to the shop · দোকানে ফিরুন
        </Link>
      </p>
      <p className="mt-3 text-center text-xs text-ink-500">
        Bangladesh business OS · বাংলাদেশের ব্যবসার সিস্টেম
      </p>
    </main>
  );
}
