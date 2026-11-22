import type { CourierAdapter, CourierBookingInput, CourierBookingResult } from "./types";

/**
 * Manual courier.
 *
 * The shop's own rider, or a courier booked by phone. Nothing is sent over the
 * network: the staff member records the tracking number (or leaves it blank
 * until the provider issues one) and the shipment moves forward by hand.
 */
export class ManualCourierAdapter implements CourierAdapter {
  readonly provider = "MANUAL" as const;

  isConfigured(): boolean {
    return true;
  }

  async book(input: CourierBookingInput): Promise<CourierBookingResult> {
    const trackingNumber = input.trackingNumber?.trim() || null;
    return {
      trackingNumber,
      consignmentId: null,
      status: trackingNumber ? "BOOKED" : "PENDING",
      labelUrl: null,
    };
  }

  async cancel(): Promise<void> {
    // Nothing was booked externally, so there is nothing to cancel remotely.
  }
}
