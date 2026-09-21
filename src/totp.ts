import { createHash, createHmac, randomBytes } from "node:crypto";
import { getDb } from "./db.ts";

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

export function initTotpTables(): void {
  const d = getDb();
  try {
    d.query("ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''").run();
  } catch {
    // column already exists — fine
  }
  d.query(`CREATE TABLE IF NOT EXISTS totp_challenges (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
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

export function getTotpSecret(userId: string): string {
  const row = getDb().query("SELECT totp_secret AS s FROM users WHERE id = ?").get(userId) as { s: string } | null;
  return row?.s ?? "";
}

export function setTotpSecret(userId: string, secret: string): void {
  getDb().query("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, userId);
}

/** Short-lived login challenge after a correct key; returns the raw token. */
export function createTotpChallenge(userId: string): string {
  const token = "tc_" + randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  getDb().query("INSERT INTO totp_challenges (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hash, userId, now, now + CHALLENGE_TTL_MS,
  );
  // Opportunistic cleanup.
  getDb().query("DELETE FROM totp_challenges WHERE expires_at < ?").run(now);
  return token;
}

export function consumeTotpChallenge(token: string): string | null {
  const hash = createHash("sha256").update(token).digest("hex");
  const row = getDb().query("SELECT user_id, expires_at FROM totp_challenges WHERE token_hash = ?").get(hash) as {
    user_id: string;
    expires_at: number;
  } | null;
  if (!row) return null;
  getDb().query("DELETE FROM totp_challenges WHERE token_hash = ?").run(hash);
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}
