import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import {
  createSession,
  deleteSession,
  getSession,
  getSetting,
  getUserById,
  getUserByUsername,
  toPublicUser,
  type PublicUser,
} from "./db.ts";

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
export async function login(username: string, key: string): Promise<PublicUser | null> {
  if (username === "admin") {
    if (!checkAdminKey(key)) return null;
    const admin = await getUserByUsername("admin");
    if (!admin) return null;
    return toPublicUser(admin);
  }
  const u = await getUserByUsername(username);
  if (!u || !u.key_hash) return null;
  if (!secretsEqual(key, u.key_hash)) return null;
  return toPublicUser(u);
}

/** Issue a fresh one-time Bearer token per successful login (stored hashed server-side). */
export async function issueToken(user: PublicUser): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex"); // 256-bit
  const expiresAt = Date.now() + config.sessionTtlMs;
  await createSession(sha256hex(token), user.id, expiresAt);
  return { token, expiresAt };
}

export async function verifyToken(token: string): Promise<PublicUser | null> {
  const s = await getSession(sha256hex(token));
  if (!s) return null;
  const u = await getUserById(s.user_id);
  if (!u) {
    await deleteSession(sha256hex(token));
    return null;
  }
  return toPublicUser(u);
}

export async function revokeToken(token: string): Promise<void> {
  await deleteSession(sha256hex(token));
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

// --- dedicated rate limiter for password recovery (admin-configurable) ---
// Separate bucket from login: recovery is anonymous-by-design (always-ok
// answers) so it needs its own, usually stricter, envelope.

const recoveryAttempts = new Map<string, number[]>();

function clampSettingInt(raw: string, min: number, max: number, fallback: number): number {
  const v = Number.parseInt(raw, 10);
  if (!Number.isInteger(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export async function recoveryLimitMax(): Promise<number> {
  return clampSettingInt(await getSetting("recovery_limit_max", "5"), 1, 100, 5);
}

export async function recoveryLimitWindowMs(): Promise<number> {
  return clampSettingInt(await getSetting("recovery_limit_window_min", "60"), 1, 1440, 60) * 60_000;
}

export async function isRecoveryLimited(ip: string): Promise<{ limited: boolean; retryAfterSec: number }> {
  const windowMs = await recoveryLimitWindowMs();
  const max = await recoveryLimitMax();
  const now = Date.now();
  const list = (recoveryAttempts.get(ip) ?? []).filter((t) => t > now - windowMs);
  recoveryAttempts.set(ip, list);
  if (list.length < max) return { limited: false, retryAfterSec: 0 };
  return { limited: true, retryAfterSec: Math.max(1, Math.ceil((list[0]! + windowMs - now) / 1000)) };
}

export function recordRecoveryAttempt(ip: string): void {
  const list = recoveryAttempts.get(ip) ?? [];
  list.push(Date.now());
  recoveryAttempts.set(ip, list);
}
