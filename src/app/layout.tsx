import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "bgd26 — বাংলাদেশের ব্যবসার এক ছাদের নিচে",
    template: "%s · bgd26",
  },
  description:
    "Unified business operating system for Bangladesh: eCommerce, POS, inventory, production, accounting, CRM and WhatsApp in one place.",
  applicationName: "bgd26",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#006a4e",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bn">
      <body className="min-h-dvh bg-white text-ink-900 antialiased">{children}</body>
    </html>
  );
}
