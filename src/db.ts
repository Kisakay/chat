import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.ts";

// --- row types ---

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  theme: string;
  email: string;
  key_hash: string;
  created_at: number;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  topic: string;
  model: string;
  archived_at: number;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  conv_id: string;
  role: string;
  content: string;
  created_at: number;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  theme: string;
  email: string;
  createdAt: number;
  isAdmin: boolean;
}

// --- db handle ---

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  mkdirSync(config.dataDir, { recursive: true });
  db = new Database(join(config.dataDir, "kisassistant.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      theme TEXT NOT NULL DEFAULT 'auto',
      key_hash TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      topic TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
    CREATE TABLE IF NOT EXISTS shares(
      conv_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      public_id TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resets(
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_provider_keys(
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, provider)
    );
  `);
  // Email column added after the initial schema — keep idempotent.
  const cols = db.query("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  // Archive flag added after the initial schema — keep idempotent.
  const convCols = db.query("PRAGMA table_info(conversations)").all() as { name: string }[];
  if (!convCols.some((c) => c.name === "archived_at")) {
    db.exec("ALTER TABLE conversations ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0");
  }
  // Admin pseudo-account row (auth still goes through APP_PASSWORD from .env).
  const admin = db.query("SELECT id FROM users WHERE username = 'admin'").get() as { id: string } | null;
  if (!admin) {
    db.query(
      "INSERT INTO users (id, username, display_name, avatar_url, theme, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), "admin", "Administrator", "", "auto", "", Date.now());
  }
  return db;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    theme: u.theme,
    email: u.email ?? "",
    createdAt: u.created_at,
    isAdmin: u.username === "admin",
  };
}

// --- users ---

export function getUserByUsername(username: string): UserRow | null {
  return getDb().query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null;
}

export function getUserById(id: string): UserRow | null {
  return getDb().query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
}

export function listUsers(): UserRow[] {
  return getDb().query("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
}

export function createUser(opts: { username: string; displayName: string; avatarUrl: string; theme: string; email: string; keyHash: string }): UserRow {
  const d = getDb();
  const row: UserRow = {
    id: randomUUID(),
    username: opts.username,
    display_name: opts.displayName,
    avatar_url: opts.avatarUrl,
    theme: opts.theme,
    email: opts.email,
    key_hash: opts.keyHash,
    created_at: Date.now(),
  };
  d.query("INSERT INTO users (id, username, display_name, avatar_url, theme, email, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    row.id, row.username, row.display_name, row.avatar_url, row.theme, row.email, row.key_hash, row.created_at,
  );
  return row;
}

export function updateUser(id: string, patch: { displayName?: string; avatarUrl?: string; theme?: string; email?: string; keyHash?: string }): UserRow | null {
  const d = getDb();
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (patch.displayName !== undefined) { sets.push("display_name = ?"); vals.push(patch.displayName); }
  if (patch.avatarUrl !== undefined) { sets.push("avatar_url = ?"); vals.push(patch.avatarUrl); }
  if (patch.theme !== undefined) { sets.push("theme = ?"); vals.push(patch.theme); }
  if (patch.email !== undefined) { sets.push("email = ?"); vals.push(patch.email); }
  if (patch.keyHash !== undefined) { sets.push("key_hash = ?"); vals.push(patch.keyHash); }
  if (sets.length > 0) {
    d.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  }
  return getUserById(id);
}

export function deleteUser(id: string): void {
  const d = getDb();
  const convs = d.query("SELECT id FROM conversations WHERE user_id = ?").all(id) as { id: string }[];
  const delMsg = d.query("DELETE FROM messages WHERE conv_id = ?");
  const delShare = d.query("DELETE FROM shares WHERE conv_id = ?");
  const delConv = d.query("DELETE FROM conversations WHERE id = ?");
  const txn = d.transaction((cid: string) => {
    delMsg.run(cid);
    delShare.run(cid);
    delConv.run(cid);
  });
  for (const c of convs) txn(c.id);
  d.query("DELETE FROM sessions WHERE user_id = ?").run(id);
  d.query("DELETE FROM resets WHERE user_id = ?").run(id);
  d.query("DELETE FROM user_provider_keys WHERE user_id = ?").run(id);
  d.query("DELETE FROM users WHERE id = ?").run(id);
}

// --- sessions ---

export function createSession(tokenHash: string, userId: string, expiresAt: number): void {
  const now = Date.now();
  getDb().query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash, userId, now, expiresAt);
}

export function getSession(tokenHash: string): SessionRow | null {
  const d = getDb();
  const s = d.query("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as SessionRow | null;
  if (!s) return null;
  if (s.expires_at <= Date.now()) {
    d.query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return s;
}

export function deleteSession(tokenHash: string): void {
  getDb().query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteUserSessions(userId: string): void {
  getDb().query("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// --- conversations ---

export function createConversation(userId: string, opts: { title?: string; topic?: string; model?: string }): ConversationRow {
  const now = Date.now();
  const row: ConversationRow = {
    id: randomUUID(),
    user_id: userId,
    title: opts.title?.slice(0, 120) || "New chat",
    topic: opts.topic?.slice(0, 120) || "",
    model: opts.model?.slice(0, 160) || "",
    archived_at: 0,
    created_at: now,
    updated_at: now,
  };
  getDb().query(
    "INSERT INTO conversations (id, user_id, title, topic, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.user_id, row.title, row.topic, row.model, row.created_at, row.updated_at);
  return row;
}

export function listConversations(userId: string): ConversationRow[] {
  return getDb().query("SELECT * FROM conversations WHERE user_id = ? AND archived_at = 0 ORDER BY updated_at DESC").all(userId) as ConversationRow[];
}

/** Archived chats: hidden from the sidebar, managed in settings. */
export function listArchivedConversations(userId: string): ConversationRow[] {
  return getDb().query("SELECT * FROM conversations WHERE user_id = ? AND archived_at != 0 ORDER BY updated_at DESC").all(userId) as ConversationRow[];
}

/**
 * (Un)archive a conversation. archived_at is left out of updated_at on
 * purpose so an unarchived chat returns to its chronological place.
 */
export function setConversationArchived(id: string, archived: boolean): ConversationRow | null {
  getDb().query("UPDATE conversations SET archived_at = ? WHERE id = ?").run(archived ? Date.now() : 0, id);
  return getConversation(id);
}

export function getConversation(id: string): ConversationRow | null {
  return getDb().query("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | null;
}

export function updateConversation(id: string, patch: { title?: string; topic?: string; model?: string }): ConversationRow | null {
  const d = getDb();
  const sets: string[] = ["updated_at = ?"];
  const vals: (string | number)[] = [Date.now()];
  if (patch.title !== undefined) { sets.push("title = ?"); vals.push(patch.title.slice(0, 120) || "New chat"); }
  if (patch.topic !== undefined) { sets.push("topic = ?"); vals.push(patch.topic.slice(0, 120)); }
  if (patch.model !== undefined) { sets.push("model = ?"); vals.push(patch.model.slice(0, 160)); }
  d.query(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getConversation(id);
}

export function touchConversation(id: string, model?: string): void {
  if (model) {
    getDb().query("UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?").run(Date.now(), model.slice(0, 160), id);
  } else {
    getDb().query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }
}

export function deleteConversation(id: string): void {
  const d = getDb();
  const txn = d.transaction(() => {
    d.query("DELETE FROM messages WHERE conv_id = ?").run(id);
    d.query("DELETE FROM shares WHERE conv_id = ?").run(id);
    d.query("DELETE FROM conversations WHERE id = ?").run(id);
  });
  txn();
}

export function addMessage(convId: string, role: string, content: string): void {
  getDb().query("INSERT INTO messages (conv_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(convId, role, content, Date.now());
}

export function getMessages(convId: string): MessageRow[] {
  return getDb().query("SELECT * FROM messages WHERE conv_id = ? ORDER BY id ASC LIMIT 500").all(convId) as MessageRow[];
}

// --- password-recovery resets (one-time, hashed, expiring) ---

export interface ResetRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export function createReset(tokenHash: string, userId: string, expiresAt: number): void {
  const d = getDb();
  // One active reset per account: replace any previous one.
  d.query("DELETE FROM resets WHERE user_id = ?").run(userId);
  d.query("INSERT INTO resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    tokenHash, userId, Date.now(), expiresAt,
  );
}

export function peekReset(tokenHash: string): ResetRow | null {
  const d = getDb();
  const r = d.query("SELECT * FROM resets WHERE token_hash = ?").get(tokenHash) as ResetRow | null;
  if (!r) return null;
  if (r.expires_at <= Date.now()) {
    d.query("DELETE FROM resets WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return r;
}

/** Consume a reset token (single use). Returns the row, or null if invalid/expired. */
export function consumeReset(tokenHash: string): ResetRow | null {
  const r = peekReset(tokenHash);
  if (!r) return null;
  getDb().query("DELETE FROM resets WHERE token_hash = ?").run(tokenHash);
  return r;
}

export function deleteUserResets(userId: string): void {
  getDb().query("DELETE FROM resets WHERE user_id = ?").run(userId);
}

// --- platform settings (admin-controlled feature flags) ---

export function getSetting(key: string, fallback: string): string {
  const r = getDb().query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return r?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb().query(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Date.now());
}

/** Public self-registration switch (default off = admin-created accounts only). */
export function isRegistrationEnabled(): boolean {
  return getSetting("registration_enabled", "0") === "1";
}

/** Admin kill-switch for the OCR platform tool (default on). */
export function isOcrToolEnabled(): boolean {
  return getSetting("tools_ocr_enabled", "1") === "1";
}

// --- public shares ---

export function ensureShare(convId: string): string {
  const d = getDb();
  const existing = d.query("SELECT public_id FROM shares WHERE conv_id = ?").get(convId) as { public_id: string } | null;
  if (existing) return existing.public_id;
  for (let i = 0; i < 5; i++) {
    const publicId = randomBytes(9).toString("base64url");
    try {
      d.query("INSERT INTO shares (conv_id, public_id, created_at) VALUES (?, ?, ?)").run(convId, publicId, Date.now());
      return publicId;
    } catch {
      // collision — retry
    }
  }
  throw new Error("could not generate share id");
}

export function getShareByConv(convId: string): string | null {
  const r = getDb().query("SELECT public_id FROM shares WHERE conv_id = ?").get(convId) as { public_id: string } | null;
  return r?.public_id ?? null;
}

export function deleteShare(convId: string): void {
  getDb().query("DELETE FROM shares WHERE conv_id = ?").run(convId);
}

export function getShareByPublic(publicId: string): { conv: ConversationRow; messages: MessageRow[]; authorName: string; authorAvatarUrl: string; archived: boolean; sharedAt: number } | null {
  const d = getDb();
  const s = d.query("SELECT * FROM shares WHERE public_id = ?").get(publicId) as { conv_id: string; created_at: number } | null;
  if (!s) return null;
  const conv = getConversation(s.conv_id);
  if (!conv) return null;
  const author = getUserById(conv.user_id);
  return {
    conv,
    messages: getMessages(conv.id).filter((m) => m.role !== "system"),
    authorName: author?.display_name || "Someone",
    authorAvatarUrl: author?.avatar_url || "",
    archived: conv.archived_at !== 0,
    sharedAt: s.created_at,
  };
}
