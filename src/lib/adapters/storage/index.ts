import { localStorageAdapter } from "./local";
import { supabaseStorageAdapter } from "./supabase";
import type { StorageAdapter, StorageProvider } from "./types";

/**
 * Which object store to use.
 *
 * Explicit `STORAGE_PROVIDER=local|supabase` always wins. Otherwise production
 * uses Supabase Storage and every other environment keeps originals on disk,
 * so development never needs cloud credentials.
 */
export function storageProvider(): StorageProvider {
  const explicit = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return process.env.NODE_ENV === "production" ? "supabase" : "local";
}

export function getStorageAdapter(): StorageAdapter {
  return storageProvider() === "supabase" ? supabaseStorageAdapter : localStorageAdapter;
}

export {
  StorageError,
  type StorageAdapter,
  type StorageObjectInfo,
  type StorageProvider,
} from "./types";
