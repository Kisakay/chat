import { randomBytes, randomUUID } from "node:crypto";
import { db, initDb, closeDb, dbKind } from "./db/client.ts";
import type { DbKind } from "./db/client.ts";

export { db, initDb, closeDb, dbKind };
export type { DbKind };

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

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  return db().get<UserRow>("SELECT * FROM users WHERE username = ?", username);
}

export async function getUserById(id: string): Promise<UserRow | null> {
  return db().get<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export async function listUsers(): Promise<UserRow[]> {
  return db().all<UserRow>("SELECT * FROM users ORDER BY created_at ASC");
}

export async function createUser(opts: { username: string; displayName: string; avatarUrl: string; theme: string; email: string; keyHash: string }): Promise<UserRow> {
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
  await db().run(
    "INSERT INTO users (id, username, display_name, avatar_url, theme, email, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    row.id, row.username, row.display_name, row.avatar_url, row.theme, row.email, row.key_hash, row.created_at,
  );
  return row;
}

export async function updateUser(id: string, patch: { username?: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string; keyHash?: string }): Promise<UserRow | null> {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (patch.username !== undefined) { sets.push("username = ?"); vals.push(patch.username); }
  if (patch.displayName !== undefined) { sets.push("display_name = ?"); vals.push(patch.displayName); }
  if (patch.avatarUrl !== undefined) { sets.push("avatar_url = ?"); vals.push(patch.avatarUrl); }
  if (patch.theme !== undefined) { sets.push("theme = ?"); vals.push(patch.theme); }
  if (patch.email !== undefined) { sets.push("email = ?"); vals.push(patch.email); }
  if (patch.keyHash !== undefined) { sets.push("key_hash = ?"); vals.push(patch.keyHash); }
  if (sets.length > 0) {
    await db().run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...vals, id);
  }
  if (patch.username !== undefined) {
    // Username is denormalized onto past reports — keep the triage list consistent.
    await db().run("UPDATE reports SET reporter_name = ? WHERE reporter_id = ?", patch.username, id);
  }
  return getUserById(id);
}

export async function deleteUser(id: string): Promise<void> {
  const d = db();
  const convs = await d.all<{ id: string }>("SELECT id FROM conversations WHERE user_id = ?", id);
  await d.transaction(async (tx) => {
    for (const c of convs) {
      await tx.run("DELETE FROM messages WHERE conv_id = ?", c.id);
      await tx.run("DELETE FROM shares WHERE conv_id = ?", c.id);
      await tx.run("DELETE FROM conversations WHERE id = ?", c.id);
    }
    await tx.run("DELETE FROM sessions WHERE user_id = ?", id);
    await tx.run("DELETE FROM resets WHERE user_id = ?", id);
    await tx.run("DELETE FROM user_provider_keys WHERE user_id = ?", id);
    await tx.run("DELETE FROM users WHERE id = ?", id);
  });
}

// --- sessions ---

export async function createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
  const now = Date.now();
  await db().run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    tokenHash, userId, now, expiresAt,
  );
}

export async function getSession(tokenHash: string): Promise<SessionRow | null> {
  const s = await db().get<SessionRow>("SELECT * FROM sessions WHERE token_hash = ?", tokenHash);
  if (!s) return null;
  if (s.expires_at <= Date.now()) {
    await db().run("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
    return null;
  }
  return s;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db().run("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db().run("DELETE FROM sessions WHERE user_id = ?", userId);
}

// --- conversations ---

export async function createConversation(userId: string, opts: { title?: string; topic?: string; model?: string }): Promise<ConversationRow> {
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
  await db().run(
    "INSERT INTO conversations (id, user_id, title, topic, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    row.id, row.user_id, row.title, row.topic, row.model, row.created_at, row.updated_at,
  );
  return row;
}

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  return db().all<ConversationRow>(
    "SELECT * FROM conversations WHERE user_id = ? AND archived_at = 0 ORDER BY updated_at DESC", userId,
  );
}

/** Archived chats: hidden from the sidebar, managed in settings. */
export async function listArchivedConversations(userId: string): Promise<ConversationRow[]> {
  return db().all<ConversationRow>(
    "SELECT * FROM conversations WHERE user_id = ? AND archived_at != 0 ORDER BY updated_at DESC", userId,
  );
}

/**
 * (Un)archive a conversation. archived_at is left out of updated_at on
 * purpose so an unarchived chat returns to its chronological place.
 */
export async function setConversationArchived(id: string, archived: boolean): Promise<ConversationRow | null> {
  await db().run("UPDATE conversations SET archived_at = ? WHERE id = ?", archived ? Date.now() : 0, id);
  return getConversation(id);
}

export async function getConversation(id: string): Promise<ConversationRow | null> {
  return db().get<ConversationRow>("SELECT * FROM conversations WHERE id = ?", id);
}

export async function updateConversation(id: string, patch: { title?: string; topic?: string; model?: string }): Promise<ConversationRow | null> {
  const sets: string[] = ["updated_at = ?"];
  const vals: (string | number)[] = [Date.now()];
  if (patch.title !== undefined) { sets.push("title = ?"); vals.push(patch.title.slice(0, 120) || "New chat"); }
  if (patch.topic !== undefined) { sets.push("topic = ?"); vals.push(patch.topic.slice(0, 120)); }
  if (patch.model !== undefined) { sets.push("model = ?"); vals.push(patch.model.slice(0, 160)); }
  await db().run(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`, ...vals, id);
  return getConversation(id);
}

export async function touchConversation(id: string, model?: string): Promise<void> {
  if (model) {
    await db().run("UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?", Date.now(), model.slice(0, 160), id);
  } else {
    await db().run("UPDATE conversations SET updated_at = ? WHERE id = ?", Date.now(), id);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.run("DELETE FROM messages WHERE conv_id = ?", id);
    await tx.run("DELETE FROM shares WHERE conv_id = ?", id);
    await tx.run("DELETE FROM conversations WHERE id = ?", id);
  });
}

export async function addMessage(convId: string, role: string, content: string): Promise<void> {
  await db().run(
    "INSERT INTO messages (conv_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    convId, role, content, Date.now(),
  );
}

export async function getMessages(convId: string): Promise<MessageRow[]> {
  return db().all<MessageRow>("SELECT * FROM messages WHERE conv_id = ? ORDER BY id ASC LIMIT 500", convId);
}

// --- password-recovery resets (one-time, hashed, expiring) ---

export interface ResetRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export async function createReset(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
  // One active reset per account: replace any previous one.
  await db().run("DELETE FROM resets WHERE user_id = ?", userId);
  await db().run(
    "INSERT INTO resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    tokenHash, userId, Date.now(), expiresAt,
  );
}

export async function peekReset(tokenHash: string): Promise<ResetRow | null> {
  const r = await db().get<ResetRow>("SELECT * FROM resets WHERE token_hash = ?", tokenHash);
  if (!r) return null;
  if (r.expires_at <= Date.now()) {
    await db().run("DELETE FROM resets WHERE token_hash = ?", tokenHash);
    return null;
  }
  return r;
}

/** Consume a reset token (single use). Returns the row, or null if invalid/expired. */
export async function consumeReset(tokenHash: string): Promise<ResetRow | null> {
  const r = await peekReset(tokenHash);
  if (!r) return null;
  await db().run("DELETE FROM resets WHERE token_hash = ?", tokenHash);
  return r;
}

export async function deleteUserResets(userId: string): Promise<void> {
  await db().run("DELETE FROM resets WHERE user_id = ?", userId);
}

// --- platform settings (admin-controlled feature flags) ---

export async function getSetting(key: string, fallback: string): Promise<string> {
  const r = await db().get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return r?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db().run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    key, value, Date.now(),
  );
}

/** Public self-registration switch (default off = admin-created accounts only). */
export async function isRegistrationEnabled(): Promise<boolean> {
  return (await getSetting("registration_enabled", "0")) === "1";
}

/** Admin kill-switch for the OCR platform tool (default on). */
export async function isOcrToolEnabled(): Promise<boolean> {
  return (await getSetting("tools_ocr_enabled", "1")) === "1";
}

/** Admin kill-switch for message reports / flag button (default on). */
export async function isReportsEnabled(): Promise<boolean> {
  return (await getSetting("reports_enabled", "1")) === "1";
}

/** Admin kill-switch for self-service username changes (default on; admins bypass). */
export async function isUsernameChangeEnabled(): Promise<boolean> {
  return (await getSetting("username_change_enabled", "1")) === "1";
}

// --- public shares ---

export async function ensureShare(convId: string): Promise<string> {
  const existing = await db().get<{ public_id: string }>("SELECT public_id FROM shares WHERE conv_id = ?", convId);
  if (existing) return existing.public_id;
  for (let i = 0; i < 5; i++) {
    const publicId = randomBytes(9).toString("base64url");
    try {
      await db().run("INSERT INTO shares (conv_id, public_id, created_at) VALUES (?, ?, ?)", convId, publicId, Date.now());
      return publicId;
    } catch {
      // collision — retry
    }
  }
  throw new Error("could not generate share id");
}

export async function getShareByConv(convId: string): Promise<string | null> {
  const r = await db().get<{ public_id: string }>("SELECT public_id FROM shares WHERE conv_id = ?", convId);
  return r?.public_id ?? null;
}

export async function deleteShare(convId: string): Promise<void> {
  await db().run("DELETE FROM shares WHERE conv_id = ?", convId);
}

export async function getShareByPublic(publicId: string): Promise<{ conv: ConversationRow; messages: MessageRow[]; authorName: string; authorAvatarUrl: string; archived: boolean; sharedAt: number } | null> {
  const s = await db().get<{ conv_id: string; created_at: number }>("SELECT * FROM shares WHERE public_id = ?", publicId);
  if (!s) return null;
  const conv = await getConversation(s.conv_id);
  if (!conv) return null;
  const author = await getUserById(conv.user_id);
  return {
    conv,
    messages: (await getMessages(conv.id)).filter((m) => m.role !== "system"),
    authorName: author?.display_name || "Someone",
    authorAvatarUrl: author?.avatar_url || "",
    archived: conv.archived_at !== 0,
    sharedAt: s.created_at,
  };
}
