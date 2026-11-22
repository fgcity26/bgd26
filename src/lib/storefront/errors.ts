/** A storefront rule failed. The message is safe to show to a shopper. */
export class StorefrontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontError";
  }
}
