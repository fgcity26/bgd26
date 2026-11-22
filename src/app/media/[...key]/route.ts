import { getStorageAdapter } from "@/lib/adapters/storage";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { getStaffSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Serve original gallery bytes.
 *
 * Local storage is streamed from `.data/media`; Supabase Storage redirects to
 * the bucket's CDN URL. Public gallery images are cacheable for a year because
 * keys are random and immutable. Private assets require a staff session with
 * catalogue access.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function contentDisposition(filename: string): string {
  const safe = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${safe || "image"}"`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const storageKey = key.join("/");

  const asset = await prisma.mediaAsset.findUnique({
    where: { storageKey },
    select: {
      storageKey: true,
      originalFilename: true,
      mimeType: true,
      byteSize: true,
      sha256Checksum: true,
      visibility: true,
    },
  });

  if (!asset) return notFound();

  if (asset.visibility === "PRIVATE") {
    const session = await getStaffSession();
    if (!session || !hasAnyPermission(session, ["product.read"])) return notFound();
  }

  const etag = `"${asset.sha256Checksum}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const cacheControl =
    asset.visibility === "PUBLIC"
      ? "public, max-age=31536000, immutable"
      : "private, no-store";

  const adapter = getStorageAdapter();
  const remote = asset.visibility === "PUBLIC" ? adapter.publicUrl(asset.storageKey) : null;

  if (remote) {
    return new Response(null, {
      status: 307,
      headers: {
        Location: remote,
        "Cache-Control": cacheControl,
        ETag: etag,
      },
    });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await adapter.open(asset.storageKey);
  } catch (error) {
    console.error("[media] could not open object", asset.storageKey, error);
    return notFound();
  }

  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.byteSize),
      "Content-Disposition": contentDisposition(asset.originalFilename),
      "Cache-Control": cacheControl,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
