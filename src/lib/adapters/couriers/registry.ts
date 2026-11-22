import type { CourierProvider } from "@/generated/prisma/client";
import { ManualCourierAdapter } from "./manual";
import { UnavailableCourierAdapter } from "./unavailable";
import type { CourierAdapter } from "./types";

/**
 * Resolve the adapter for a provider.
 *
 * A missing provider is a programming error, not a user error, so the switch is
 * exhaustive: adding a provider to the enum without an adapter fails the build.
 */
export function getCourierAdapter(provider: CourierProvider): CourierAdapter {
  switch (provider) {
    case "MANUAL":
    case "DROPSHIP_SUPPLIER":
      return new ManualCourierAdapter();
    case "PATHAO":
      return new UnavailableCourierAdapter("PATHAO", "PATHAO_");
    case "STEADFAST":
      return new UnavailableCourierAdapter("STEADFAST", "STEADFAST_");
    case "REDX":
      return new UnavailableCourierAdapter("REDX", "REDX_");
    default: {
      const exhaustive: never = provider;
      throw new Error(`No courier adapter for ${String(exhaustive)}.`);
    }
  }
}
