/**
 * The object-storage port.
 *
 * Business code never talks to S3, Supabase Storage or the filesystem directly.
 * An adapter only moves bytes and reports what it stored; it never resizes,
 * recompresses or rewrites them (zero-transform media, docs/ARCHITECTURE.md §10).
 */
export type StorageProvider = "local" | "supabase";

export type StorageObjectInfo = {
  /** Size of the stored object in bytes. */
  byteSize: number;
  /** SHA-256 of the stored bytes, computed by re-reading the object. */
  sha256: string;
};

export class StorageError extends Error {
  constructor(
    readonly code:
      | "NOT_CONFIGURED"
      | "ALREADY_EXISTS"
      | "NOT_FOUND"
      | "INVALID_KEY"
      | "PROVIDER_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface StorageAdapter {
  readonly provider: StorageProvider;

  /**
   * Write immutable bytes under `key`. Implementations must refuse to overwrite
   * an existing object: keys are random and never reused.
   */
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<void>;

  /** Re-read the stored object and return its true size and SHA-256. */
  inspect(key: string): Promise<StorageObjectInfo>;

  /** Open the stored object for reading. Bytes are returned exactly as stored. */
  open(key: string): Promise<ReadableStream<Uint8Array>>;

  /** Public base URL for the object, or null when the adapter serves it itself. */
  publicUrl(key: string): string | null;

  /** Remove an object. Only used to clean up a failed upload, never on request. */
  remove(key: string): Promise<void>;
}
