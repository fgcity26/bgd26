import { WhatsappTabs } from "@/components/whatsapp/whatsapp-tabs";

export const metadata = {
  title: "WhatsApp",
  robots: { index: false, follow: false },
};

/**
 * WhatsApp console shell. Each page below calls `requirePagePermission` itself,
 * because React renders a layout and its page in parallel and a redirect thrown
 * here would abort the page query mid-flight.
 */
export default function WhatsappLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp · হোয়াটসঅ্যাপ</h1>
        <p className="mt-1 text-sm text-ink-500">
          Order updates, consent, delivery receipts and the customer inbox — official Cloud API only.
        </p>
      </header>
      <WhatsappTabs />
      {children}
    </div>
  );
}
