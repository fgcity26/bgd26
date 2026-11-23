import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { StorageError, type StorageAdapter } from "./types";

/**
 * Supabase Storage adapter.
 *
 * The bucket is private: gallery bytes are streamed through `/media/[...key]`
 * (the `/object/public/` endpoint rejects private buckets), while production
 * originals and customer files require a staff session for the same route.
 * Direct uploads use short-lived signed URLs issued by a server action, so the
 * service-role key never reaches the browser.
 */
function storageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new StorageError(
      "NOT_CONFIGURED",
      "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or set STORAGE_PROVIDER=local.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "bgd26-media";
}

function assertKey(key: string): void {
  if (!key || key.length > 512 || key.includes("..") || key.startsWith("/")) {
    throw new StorageError("INVALID_KEY", "Invalid storage key.");
  }
}

export const supabaseStorageAdapter: StorageAdapter = {
  provider: "supabase",

  async put({ key, bytes, contentType }) {
    assertKey(key);
    const { error } = await storageClient()
      .storage.from(bucketName())
      .upload(key, bytes, {
        contentType,
        // Immutable keys: never overwrite an existing object.
        upsert: false,
        cacheControl: "31536000",
      });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("already exists") || message.includes("duplicate")) {
        throw new StorageError("ALREADY_EXISTS", "That storage key already exists.");
      }
      throw new StorageError("PROVIDER_ERROR", error.message);
    }
  },

  async createSignedUploadUrl({ key }) {
    assertKey(key);
    const { data, error } = await storageClient()
      .storage.from(bucketName())
      .createSignedUploadUrl(key);

    if (error || !data) {
      throw new StorageError(
        "PROVIDER_ERROR",
        error?.message ?? "Could not create a signed upload URL.",
      );
    }

    return { uploadUrl: data.signedUrl, token: data.token, expiresInSeconds: null };
  },

  async inspect(key) {
    assertKey(key);
    const { data, error } = await storageClient().storage.from(bucketName()).download(key);
    if (error || !data) {
      throw new StorageError(
        error?.message.toLowerCase().includes("not found") ? "NOT_FOUND" : "PROVIDER_ERROR",
        error?.message ?? "Stored object not found.",
      );
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    return {
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  },

  async open(key) {
    assertKey(key);
    const { data, error } = await storageClient().storage.from(bucketName()).download(key);
    if (error || !data) {
      throw new StorageError(
        error?.message.toLowerCase().includes("not found") ? "NOT_FOUND" : "PROVIDER_ERROR",
        error?.message ?? "Stored object not found.",
      );
    }
    return data.stream() as ReadableStream<Uint8Array>;
  },

  publicUrl(key) {
    assertKey(key);
    return storageClient().storage.from(bucketName()).getPublicUrl(key).data.publicUrl;
  },

  async remove(key) {
    assertKey(key);
    const { error } = await storageClient().storage.from(bucketName()).remove([key]);
    if (error) throw new StorageError("PROVIDER_ERROR", error.message);
  },
};
