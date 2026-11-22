import type { CourierAdapter, CourierBookingInput, CourierBookingResult } from "./types";
import { CourierError } from "./types";

/**
 * Placeholder for a provider whose API is not wired yet.
 *
 * Seeded couriers exist for Pathao, Steadfast and RedX so an order can record
 * which company carried it, but booking through their API needs credentials and
 * a tested client. Until then the honest answer is a clear error, not a fake
 * tracking number: staff can book with the manual courier and paste the real
 * tracking number in.
 */
export class UnavailableCourierAdapter implements CourierAdapter {
  constructor(
    readonly provider: "PATHAO" | "STEADFAST" | "REDX",
    private readonly envPrefix: string,
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async book(_input: CourierBookingInput): Promise<CourierBookingResult> {
    void _input;
    throw new CourierError(
      `The ${this.provider.toLowerCase()} adapter is not wired yet. ` +
        `Create a manual courier booking and paste the tracking number, or add the ` +
        `${this.envPrefix} credentials and implement the adapter.`,
    );
  }

  async cancel(): Promise<void> {
    throw new CourierError(`The ${this.provider.toLowerCase()} adapter is not wired yet.`);
  }
}
