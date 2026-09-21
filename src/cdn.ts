import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";

// --- local file CDN -----------------------------------------------
// Generic, future-proof layout:
//
//   PUT /cdn/<ns>/<key>          (auth)   -> { url: "/cdn/<ns>/<key>.<ext>" }
//   GET /cdn/<ns>/<key>.<ext>    (public)
//
// <ns> is a registered namespace (see CDN_NAMESPACES — `avatar` today,
// more tomorrow). <key> is namespaced client-chosen id ([A-Za-z0-9_-]).
// The stored extension ALWAYS comes from magic-byte detection, never from
// the client. Everything else is systematically blacklisted.

export type ImageExt = "jpg" | "png" | "webp";

export interface CdnNamespace {
  maxBytes: number;
  windowMs: number;
  maxUploads: number;
}

export const CDN_NAMESPACES: Record<string, CdnNamespace> = {
  // Avatar rules (spec): 5 MB max, 5 changes max per 2 h per account.
  avatar: { maxBytes: 5 * 1024 * 1024, windowMs: 2 * 3600_000, maxUploads: 5 },
};

export const CDN_EXTS: ImageExt[] = ["jpg", "png", "webp"];

const CDN_MIME: Record<ImageExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function cdnMime(ext: ImageExt): string {
  return CDN_MIME[ext];
}

export function validNamespace(ns: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(ns) && ns in CDN_NAMESPACES;
}

export function validKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

export function validExt(ext: string): ext is ImageExt {
  return (CDN_EXTS as string[]).includes(ext);
}

function cdnDir(): string {
  return config.cdnDir;
}

export function cdnPath(ns: string, key: string, ext: ImageExt): string {
  return join(cdnDir(), ns, `${key}.${ext}`);
}

export async function cdnFile(ns: string, key: string, ext: ImageExt): Promise<{ path: string; exists: boolean }> {
  const path = cdnPath(ns, key, ext);
  return { path, exists: await Bun.file(path).exists() };
}

/**
 * Detect the real image type from magic bytes (first bytes of the file).
 * Extension alone is NEVER trusted.
 *   JPEG: FF D8 FF
 *   PNG:  89 50 4E 47 0D 0A 1A 0A
 *   WEBP: "RIFF"...."WEBP" (bytes 0-3 and 8-11)
 */
export function detectImageType(buf: Uint8Array): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  return null;
}

/** Remove every stored variant for a key (used before replacing an avatar). */
export async function removeCdnVariants(ns: string, key: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  for (const ext of CDN_EXTS) {
    try {
      await unlink(cdnPath(ns, key, ext));
    } catch {
      // missing — fine
    }
  }
}

export async function writeCdnFile(ns: string, key: string, ext: ImageExt, data: Uint8Array): Promise<string> {
  await mkdir(join(cdnDir(), ns), { recursive: true });
  await removeCdnVariants(ns, key);
  await Bun.write(cdnPath(ns, key, ext), data);
  return `/cdn/${ns}/${key}.${ext}`;
}

// --- per-account upload rate limiter (sliding window) ---

const uploads = new Map<string, number[]>();

export function uploadAllowed(userId: string, ns: string): { ok: boolean; retryAfterSec: number } {
  const cfg = CDN_NAMESPACES[ns]!;
  const now = Date.now();
  const k = `${ns}:${userId}`;
  const list = (uploads.get(k) ?? []).filter((t) => t > now - cfg.windowMs);
  uploads.set(k, list);
  if (list.length >= cfg.maxUploads) {
    const retryAfterSec = Math.ceil((list[0]! + cfg.windowMs - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function recordUpload(userId: string, ns: string): void {
  const k = `${ns}:${userId}`;
  const list = uploads.get(k) ?? [];
  list.push(Date.now());
  uploads.set(k, list);
}
