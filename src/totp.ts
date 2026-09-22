import { createHash, createHmac, randomBytes } from "node:crypto";
import { db } from "./db.ts";

/**
 * TOTP two-factor (RFC 6238, SHA-1, 30s step, 6 digits, ±1 window).
 * The per-user secret lives in `users.totp_secret` (empty = disabled);
 * login challenges live in `totp_challenges`. Tables/columns are created
 * idempotently here so db.ts stays untouched.
 */

const STEP_SEC = 30;
const DIGITS = 6;
const WINDOW = 1;
const CHALLENGE_TTL_MS = 5 * 60_000;

export async function initTotpTables(): Promise<void> {
  const d = db();
  if (d.kind === "sqlite") {
    try {
      await d.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''");
    } catch {
      // column already exists — fine
    }
  } else {
    await d.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT ''");
  }
  await d.exec(`CREATE TABLE IF NOT EXISTS totp_challenges (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`);
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function totpAuthUrl(secret: string, username: string, issuer = "KisAssistant"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function base32Decode(s: string): Buffer {
  const clean = s.trim().replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: bigint): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const h = createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code =
    ((h[offset]! & 0x7f) << 24) | ((h[offset + 1]! << 16) | ((h[offset + 2]! << 8) | h[offset + 3]!));
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Timing-safe comparison against the current ±1 window. */
export function verifyTotp(secret: string, code: string): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  if (key.length < 10) return false;
  const now = Math.floor(Date.now() / 1000 / STEP_SEC);
  let ok = false;
  for (let w = -WINDOW; w <= WINDOW; w++) {
    const expected = hotp(key, BigInt(now + w));
    const a = Buffer.from(expected);
    const b = Buffer.from(c);
    if (a.length === b.length && createHash("sha256").update(a).digest().equals(createHash("sha256").update(b).digest())) {
      ok = true;
    }
  }
  // Constant-time-ish: always hash-compare all window slots (loop above).
  return ok;
}

export async function getTotpSecret(userId: string): Promise<string> {
  const row = await db().get<{ s: string }>("SELECT totp_secret AS s FROM users WHERE id = ?", userId);
  return row?.s ?? "";
}

export async function setTotpSecret(userId: string, secret: string): Promise<void> {
  await db().run("UPDATE users SET totp_secret = ? WHERE id = ?", secret, userId);
}

/** Short-lived login challenge after a correct key; returns the raw token. */
export async function createTotpChallenge(userId: string): Promise<string> {
  const token = "tc_" + randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  await db().run(
    "INSERT INTO totp_challenges (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    hash, userId, now, now + CHALLENGE_TTL_MS,
  );
  // Opportunistic cleanup.
  await db().run("DELETE FROM totp_challenges WHERE expires_at < ?", now);
  return token;
}

export async function consumeTotpChallenge(token: string): Promise<string | null> {
  const hash = createHash("sha256").update(token).digest("hex");
  const row = await db().get<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM totp_challenges WHERE token_hash = ?", hash,
  );
  if (!row) return null;
  await db().run("DELETE FROM totp_challenges WHERE token_hash = ?", hash);
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}

/** Housekeeping for account deletion (no other caller needs it). */
export async function deleteTotpChallenges(userId: string): Promise<void> {
  await db().run("DELETE FROM totp_challenges WHERE user_id = ?", userId);
}
