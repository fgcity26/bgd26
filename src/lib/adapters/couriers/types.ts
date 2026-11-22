import type { CourierProvider, ShipmentStatus } from "@/generated/prisma/client";

/**
 * Courier adapter port.
 *
 * A courier is an external service that turns an order into a consignment and
 * later reports what happened to it. Every provider is reached through this
 * interface so the shipping service never imports a provider SDK directly.
 *
 * Only the manual adapter is wired today: it records the consignment and the
 * tracking number a person typed in. Pathao, Steadfast and RedX arrive with
 * their credentials; adding one means implementing this port, not touching the
 * shipment workflow.
 */

export type CourierBookingInput = {
  shipmentNumber: string;
  orderNumber: string;
  recipientName: string;
  recipientMobile: string;
  address: string;
  district: string;
  division: string;
  /** Cash the courier must collect on delivery. */
  codAmount: string;
  deliveryCharge: string;
  /** Present when a person already has the provider's tracking number. */
  trackingNumber?: string | null;
  note?: string | null;
};

export type CourierBookingResult = {
  trackingNumber: string | null;
  consignmentId: string | null;
  /** `PENDING` when no tracking number exists yet, `BOOKED` once it does. */
  status: Extract<ShipmentStatus, "PENDING" | "BOOKED">;
  labelUrl: string | null;
};

export interface CourierAdapter {
  readonly provider: CourierProvider;
  /** False when the provider's credentials are absent; booking then refuses. */
  isConfigured(): boolean;
  book(input: CourierBookingInput): Promise<CourierBookingResult>;
  cancel(trackingNumber: string | null): Promise<void>;
}

export class CourierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourierError";
  }
}
