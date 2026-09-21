import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import {
  createSession,
  deleteSession,
  getDb,
  getSession,
  getUserById,
  getUserByUsername,
  toPublicUser,
  type PublicUser,
} from "./db.ts";

// Ensure DB + admin row exist at startup.
getDb();

export type { PublicUser };

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Compare two secrets in constant time (via their hashes so lengths match). */
export function secretsEqual(a: string, bHash: string): boolean {
  const aHash = sha256hex(a);
  const ab = Buffer.from(aHash, "utf8");
  const bb = Buffer.from(bHash, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hashSecret(s: string): string {
  return sha256hex(s);
}

/** Fresh random per-account access key (No-KYC: admin hands it to the user). Shown only once. */
export function newAccessKey(): string {
  return "ka_" + randomBytes(24).toString("base64url");
}

function checkAdminKey(candidate: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(config.appPassword).digest();
  return timingSafeEqual(a, b);
}

/**
 * Login with { username, key }.
 * - username "admin" authenticates against APP_PASSWORD (.env).
 * - other usernames authenticate against their admin-issued access key.
 */
export function login(username: string, key: string): PublicUser | null {
  if (username === "admin") {
    if (!checkAdminKey(key)) return null;
    const admin = getUserByUsername("admin");
    if (!admin) return null;
    return toPublicUser(admin);
  }
  const u = getUserByUsername(username);
  if (!u || !u.key_hash) return null;
  if (!secretsEqual(key, u.key_hash)) return null;
  return toPublicUser(u);
}

/** Issue a fresh one-time Bearer token per successful login (stored hashed in SQLite). */
export function issueToken(user: PublicUser): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex"); // 256-bit
  const expiresAt = Date.now() + config.sessionTtlMs;
  createSession(sha256hex(token), user.id, expiresAt);
  return { token, expiresAt };
}

export function verifyToken(token: string): PublicUser | null {
  const s = getSession(sha256hex(token));
  if (!s) return null;
  const u = getUserById(s.user_id);
  if (!u) {
    deleteSession(sha256hex(token));
    return null;
  }
  return toPublicUser(u);
}

export function revokeToken(token: string): void {
  deleteSession(sha256hex(token));
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

// --- sliding-window rate limiter (per IP) for /api/auth/login ---

const attempts = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;
  const list = (attempts.get(ip) ?? []).filter((t) => t > windowStart);
  attempts.set(ip, list);
  return list.length >= config.rateLimitMax;
}

export function recordAttempt(ip: string): void {
  const list = attempts.get(ip) ?? [];
  list.push(Date.now());
  attempts.set(ip, list);
}

export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}
