import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export default async function DashboardPage() {
  const session = await requireStaff();
  const firstName = session.user.fullName.split(" ")[0];

  const cards = [
    {
      label: "Roles",
      labelBn: "ভূমিকা",
      value: session.roles.join(", ") || "—",
      note: "Assigned by the owner",
    },
    {
      label: "Permissions",
      labelBn: "অনুমতি",
      value: String(session.permissions.size),
      note: "Effective permissions from all roles",
    },
    {
      label: "Last sign-in",
      labelBn: "সর্বশেষ প্রবেশ",
      value: session.user.lastLoginAt ? dateTime.format(session.user.lastLoginAt) : "First sign-in",
      note: "Asia/Dhaka",
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Welcome, {firstName}</h1>
        <p className="mt-1 text-sm text-ink-500">
          আপনার কাজ শুরু করার জায়গা। বাঁ দিকের মেনু থেকে প্রয়োজনীয় অংশে যান।
        </p>
      </header>

      {session.user.managerPinHash === null ? (
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">Manager PIN not set</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            A six-digit PIN authorises discounts above 5 %, walk-in cash sales and
            manual payment verification. Set one now so the counter is never blocked.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-700">
            ৳৫%-এর বেশি ছাড় বা নগদ বিক্রয়ের অনুমতির জন্য ৬ সংখ্যার পিন দরকার।
          </p>
          <Link
            href="/profile#pin"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Set manager PIN · পিন দিন
          </Link>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {card.label} · {card.labelBn}
            </p>
            <p className="mt-2 break-words text-lg font-semibold text-ink-900">{card.value}</p>
            <p className="mt-1 text-xs text-ink-500">{card.note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">What comes next</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-700">
          Products, inventory, purchasing, customers, reviews, CMS pages, the counter till, the
          sales ledger and the books are live. Stock is tracked per warehouse with moving-average
          cost and an append-only ledger; purchase orders arrive through goods receipts. The till
          prices every sale on the server, keeps working offline and never rejects a queued sale,
          and digital money waits for a manager&apos;s verification. Accounting posts a balanced,
          immutable journal for every sale, payment, refund, receipt, adjustment and expense, with
          a trial balance, chart of accounts and ledger to read it. Loyalty earns points on paid
          sales, caps redemption at 20 % of net merchandise, expires after twelve months and posts
          its own liability journal. The public storefront is live too: a guest can browse, use a
          coupon, choose a delivery zone and order with cash on delivery or manual bKash/Nagad, and
          the order runs through the same engine as the counter. Shipping books the parcel with a
          courier, records tracking events and clears cash on delivery when the courier pays over.
          Reports read that same journal as a profit and loss, a balance sheet and a cash-flow
          statement. Purchases now settle too: a supplier payment reduces the payable, a return
          sends goods back at average cost, and a statement shows every movement. Production takes
          an order line from design proof through approval, issues materials at average cost into
          work in progress, and clears that value on completion or cancellation. Dropshipping
          raises the supplier order from the sale, ships direct and recognises the supplier cost
          once. Customers can now keep an optional online account: the mobile number is the login,
          with order history, saved addresses and a points ledger, and a signed-in checkout can
          spend points against the same capped balance as the counter. WhatsApp comes next.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          পণ্য, স্টক, ক্রয়, ক্রেতা, রিভিউ, সাইটের পাতা, কাউন্টার, বিক্রয় খাতা ও হিসাব চালু হয়েছে।
          প্রতিটি গুদামের স্টক আলাদা, চলমান গড় খরচে; সংশোধন ড্রাফট করে ম্যানেজার পোস্ট করেন।
          কাউন্টার অফলাইনেও বিক্রি নেয়, প্রতিটি দাম সার্ভারে আবার হিসাব হয়, আর ডিজিটাল পেমেন্ট
          ম্যানেজার যাচাই করার আগে অপেক্ষমাণ থাকে। প্রতিটি বিক্রি, পেমেন্ট, ফেরত, মাল গ্রহণ ও
          খরচ একটি ভারসাম্যপূর্ণ ও অপরিবর্তনীয় জার্নালে পোস্ট হয়; জের, হিসাবের তালিকা ও খাতা
          দিয়ে তা দেখা যায়। লয়্যালটিতে পরিশোধিত বিক্রয়ে পয়েন্ট জমা হয়, নিট পণ্যমূল্যের
          সর্বোচ্চ ২০% পয়েন্টে মেটানো যায়, ১২ মাসে মেয়াদ শেষ হয় ও নিজস্ব দায় জার্নাল হয়।
          পাবলিক অনলাইন দোকানও চালু: লগইন ছাড়াই পণ্য দেখা, কুপন লাগানো, ডেলিভারি জোন বেছে
          ক্যাশ অন ডেলিভারি বা বিকাশ/নগদে অর্ডার করা যায়, আর অর্ডারটি কাউন্টারের মতোই একই
          ইঞ্জিনে তৈরি হয়। চালানে কুরিয়ারে পার্সেল বুক হয়, ট্র্যাকিং ইভেন্ট লেখা হয়, আর
          কুরিয়ার টাকা ফেরত দিলে ক্যাশ অন ডেলিভারি মিলিয়ে নেওয়া হয়। ওই একই খাতা থেকেই
          লাভ-ক্ষতি, উদ্বৃত্তপত্র ও নগদ প্রবাহের বিবরণী দেখা যায়। ক্রয়ের হিসাবও এখন মেলে:
          সরবরাহকারীকে পরিশোধ পাওনা কমায়, মাল ফেরত গড় দামে স্টক কমায়, আর বিবরণীপত্রে
          প্রতিটি লেনদেন ও ক্রমবর্ধমান ব্যালেন্স দেখা যায়। উৎপাদনে অর্ডার লাইন ডিজাইন প্রুফ ও
          অনুমোদন থেকে শুরু করে চলমান গড় দামে উপকরণ বের করে চলমান উৎপাদনে জমা রাখে, আর কাজ
          শেষ বা বাতিল হলে সেই মূল্য মিটিয়ে দেয়। ড্রপশিপিং বিক্রয় থেকেই সরবরাহকারীর অর্ডার
          তৈরি করে, সরাসরি পাঠায় ও সরবরাহকারীর খরচ একবারই হিসাবে নেয়। ক্রেতা এখন চাইলে অনলাইন
          অ্যাকাউন্ট রাখতে পারেন—মোবাইল নম্বরই লগইন, সাথে অর্ডারের ইতিহাস, সংরক্ষিত ঠিকানা ও
          পয়েন্টের খাতা; লগইন করা ক্রেতা কাউন্টারের মতোই নির্ধারিত সীমার মধ্যে পয়েন্ট খরচ
          করতে পারেন। এরপর হোয়াটসঅ্যাপ আসবে।
        </p>
      </section>
    </div>
  );
}
