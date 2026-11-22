import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root to this folder. Without it, a stray package-lock.json
  // in a parent directory (for example /home/<user>) makes Next treat the whole
  // home folder as the project and warn on every build.
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  // Server-only packages must never be bundled into client components.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  experimental: {
    // Gallery uploads go straight to a server action. The 20 MB per-file cap is
    // enforced in `src/lib/media/validate.ts`; this limit only leaves room for
    // multipart overhead.
    serverActions: { bodySizeLimit: "22mb" },
  },
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
