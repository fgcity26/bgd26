import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { StorageError, type StorageAdapter } from "./types";

/**
 * Local filesystem adapter.
 *
 * Used in development and on a single self-hosted server. The directory is
 * outside `public/` on purpose: originals are served through the permission-
 * checked `/media/[...key]` route, not by static file serving.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function storageRoot(): string {
  // Runtime data, not build input. `turbopackIgnore` stops the bundler from
  // tracing the whole project just because this path is configured by env.
  return resolve(/* turbopackIgnore: true */ process.env.STORAGE_LOCAL_DIR?.trim() || ".data/media");
}

function resolveKey(key: string): string {
  if (!key || key.length > 512 || !KEY_PATTERN.test(key) || key.includes("..")) {
    throw new StorageError("INVALID_KEY", "Invalid storage key.");
  }

  const root = storageRoot();
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new StorageError("INVALID_KEY", "Storage key escapes the media directory.");
  }
  return target;
}

async function hashFile(path: string): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;

  await new Promise<void>((done, fail) => {
    const stream = createReadStream(/* turbopackIgnore: true */ path);
    stream.on("data", (chunk) => {
      byteSize += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", fail);
    stream.on("end", done);
  });

  return { sha256: hash.digest("hex"), byteSize };
}

export const localStorageAdapter: StorageAdapter = {
  provider: "local",

  async put({ key, bytes }) {
    const target = resolveKey(key);
    await mkdir(/* turbopackIgnore: true */ dirname(target), { recursive: true });

    try {
      // `wx` fails when the file exists: immutable keys are never overwritten.
      await writeFile(/* turbopackIgnore: true */ target, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new StorageError("ALREADY_EXISTS", "That storage key already exists.");
      }
      throw error;
    }
  },

  async inspect(key) {
    const target = resolveKey(key);
    try {
      await stat(/* turbopackIgnore: true */ target);
    } catch {
      throw new StorageError("NOT_FOUND", "Stored object not found.");
    }
    return hashFile(target);
  },

  async open(key) {
    const target = resolveKey(key);
    try {
      await stat(/* turbopackIgnore: true */ target);
    } catch {
      throw new StorageError("NOT_FOUND", "Stored object not found.");
    }

    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  },

  publicUrl() {
    // Served by the app's own `/media/[...key]` route.
    return null;
  },

  async remove(key) {
    const target = resolveKey(key);
    await unlink(/* turbopackIgnore: true */ target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
};

/** Test helper: read bytes directly from the local adapter's directory. */
export async function readLocalObject(key: string): Promise<Uint8Array> {
  return readFile(/* turbopackIgnore: true */ resolveKey(key));
}
